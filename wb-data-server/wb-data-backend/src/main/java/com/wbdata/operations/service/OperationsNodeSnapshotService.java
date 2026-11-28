package com.wbdata.operations.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wbdata.datasource.entity.DataSource;
import com.wbdata.datasource.mapper.DataSourceMapper;
import com.wbdata.git.service.GitSyncFlowSourceBuilder;
import com.wbdata.offline.execution.dto.ExecutionTaskRun;
import com.wbdata.offline.kestra.KestraClient;
import com.wbdata.offline.kestra.KestraExecutionPage;
import com.wbdata.offline.kestra.KestraExecutionSnapshot;
import com.wbdata.offline.parameter.dto.ExecutionParameterValueResponse;
import com.wbdata.offline.parameter.service.ScriptParameterRenderer;
import com.wbdata.offline.repo.service.GitCommandService;
import com.wbdata.offline.service.OfflineFlowInspector;
import com.wbdata.offline.transfer.dto.TransferConfig;
import com.wbdata.offline.transfer.dto.TransferEndpointConfig;
import com.wbdata.offline.transfer.dto.TransferFieldMapping;
import com.wbdata.offline.transfer.dto.TransferMappingKind;
import com.wbdata.offline.transfer.dto.TransferPartitionMapping;
import com.wbdata.offline.transfer.service.TransferParameters;
import com.wbdata.operations.dto.OperationsExecutionGraphNode;
import com.wbdata.operations.dto.OperationsExecutionNodeSnapshotResponse;
import com.wbdata.operations.dto.OperationsRerunGraphEdge;
import com.wbdata.operations.dto.OperationsTransferSnapshot;
import com.wbdata.sql.SqlParameterTemplate;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.lang.Nullable;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 为运维中心提供执行期 DAG 图全集拼装与节点执行时脚本/配置快照还原。
 */
@Slf4j
final class OperationsNodeSnapshotService {

    private static final String SOURCE_EXECUTION_COMMIT = "EXECUTION_COMMIT";
    private static final String SOURCE_CURRENT_ONLINE = "CURRENT_ONLINE";
    private static final String SOURCE_UNAVAILABLE = "UNAVAILABLE";
    private static final String STATUS_NOT_RUN = "NOT_RUN";
    private static final String GATE_TASK_ID = OperationsInstanceDiagnosisService.GATE_TASK_ID;
    private static final Pattern GIT_SHA_PATTERN = Pattern.compile("[0-9a-fA-F]{40,64}");

    private final KestraClient kestraClient;
    private final OfflineFlowInspector flowInspector;
    @Nullable
    private final GitCommandService gitCommandService;
    @Nullable
    private final DataSourceMapper dataSourceMapper;
    private final ObjectMapper objectMapper;

    OperationsNodeSnapshotService(KestraClient kestraClient,
                                  OfflineFlowInspector flowInspector,
                                  @Nullable GitCommandService gitCommandService,
                                  @Nullable DataSourceMapper dataSourceMapper,
                                  @Nullable ObjectMapper objectMapper) {
        this.kestraClient = kestraClient;
        this.flowInspector = flowInspector;
        this.gitCommandService = gitCommandService;
        this.dataSourceMapper = dataSourceMapper;
        this.objectMapper = objectMapper != null ? objectMapper : new ObjectMapper();
    }

    ExecutionGraphResult buildExecutionGraph(KestraExecutionSnapshot execution, List<ExecutionTaskRun> visibleTaskRuns) {
        String flowSource = loadExecutionFlowSource(execution);
        if (flowSource == null || flowSource.isBlank()) {
            return ExecutionGraphResult.empty();
        }
        OfflineFlowInspector.InspectedGraph inspected;
        try {
            inspected = flowInspector.inspectGraph(flowSource);
        } catch (RuntimeException ex) {
            log.debug("解析执行期 DAG 失败: executionId={}, flowId={}, message={}",
                    execution.id(), execution.flowId(), ex.getMessage());
            return ExecutionGraphResult.empty();
        }

        List<OfflineFlowInspector.InspectedNode> inspectedNodes = inspected.nodes() == null ? List.of() : inspected.nodes();
        if (inspectedNodes.isEmpty()) {
            return ExecutionGraphResult.empty();
        }

        Map<String, ExecutionTaskRun> taskRunById = new LinkedHashMap<>();
        if (visibleTaskRuns != null) {
            for (ExecutionTaskRun taskRun : visibleTaskRuns) {
                if (taskRun != null && taskRun.taskId() != null && !taskRun.taskId().isBlank()) {
                    taskRunById.put(taskRun.taskId(), taskRun);
                }
            }
        }

        List<OperationsExecutionGraphNode> graphNodes = new ArrayList<>(inspectedNodes.size());
        Set<String> validNodeIds = new LinkedHashSet<>();
        for (OfflineFlowInspector.InspectedNode node : inspectedNodes) {
            if (node == null || node.taskId() == null || node.taskId().isBlank()) {
                continue;
            }
            validNodeIds.add(node.taskId());
            ExecutionTaskRun run = taskRunById.remove(node.taskId());
            boolean hasCodeSnapshot = hasNonBlank(node.scriptPath()) || hasNonBlank(node.transferConfigPath());
            if (run != null) {
                graphNodes.add(new OperationsExecutionGraphNode(
                        node.taskId(),
                        node.kind(),
                        node.dataSourceType(),
                        run.status(),
                        run.startDate(),
                        run.endDate(),
                        run.durationMs(),
                        hasCodeSnapshot
                ));
            } else {
                graphNodes.add(new OperationsExecutionGraphNode(
                        node.taskId(),
                        node.kind(),
                        node.dataSourceType(),
                        STATUS_NOT_RUN,
                        null,
                        null,
                        null,
                        hasCodeSnapshot
                ));
            }
        }

        for (ExecutionTaskRun extraRun : taskRunById.values()) {
            if (GATE_TASK_ID.equals(extraRun.taskId())) {
                continue;
            }
            validNodeIds.add(extraRun.taskId());
            graphNodes.add(new OperationsExecutionGraphNode(
                    extraRun.taskId(),
                    "SHELL",
                    null,
                    extraRun.status(),
                    extraRun.startDate(),
                    extraRun.endDate(),
                    extraRun.durationMs(),
                    false
            ));
        }

        List<OfflineFlowInspector.InspectedEdge> inspectedEdges = inspected.edges() == null ? List.of() : inspected.edges();
        List<OperationsRerunGraphEdge> graphEdges = inspectedEdges.stream()
                .filter(edge -> edge != null
                        && validNodeIds.contains(edge.source())
                        && validNodeIds.contains(edge.target()))
                .map(edge -> new OperationsRerunGraphEdge(edge.source(), edge.target()))
                .toList();

        return new ExecutionGraphResult(List.copyOf(graphNodes), List.copyOf(graphEdges));
    }

    OperationsExecutionNodeSnapshotResponse loadNodeSnapshot(Long groupId,
                                                             KestraExecutionSnapshot execution,
                                                             @Nullable String branch,
                                                             String taskId,
                                                             List<ExecutionParameterValueResponse> resolvedParameters,
                                                             Map<String, String> rawInputs) {
        String flowSource = loadExecutionFlowSource(execution);
        if (flowSource == null || flowSource.isBlank()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "未找到该执行对应的任务定义");
        }
        OfflineFlowInspector.InspectedGraph graph;
        try {
            graph = flowInspector.inspectGraph(flowSource);
        } catch (RuntimeException ex) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "解析执行任务定义失败", ex);
        }

        OfflineFlowInspector.InspectedNode node = graph.nodes().stream()
                .filter(candidate -> candidate != null && taskId.equals(candidate.taskId()))
                .findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "任务节点不存在: " + taskId));

        String kind = normalizeKind(node.kind());
        boolean isTransfer = "TRANSFER".equals(kind);
        String filePath = isTransfer ? node.transferConfigPath() : node.scriptPath();
        String dataSourceName = resolveDataSourceName(node.dataSourceId());

        ResolvedContent resolvedContent = resolveNodeFileContent(groupId, execution, branch, filePath);
        if (!resolvedContent.contentAvailable()) {
            return new OperationsExecutionNodeSnapshotResponse(
                    execution.id(),
                    node.taskId(),
                    kind,
                    node.dataSourceType(),
                    node.dataSourceId(),
                    dataSourceName,
                    filePath,
                    resolvedContent.snapshotSource(),
                    resolvedContent.commitSha(),
                    resolvedContent.exactSnapshot(),
                    resolvedContent.notice(),
                    false,
                    null,
                    null,
                    null,
                    null,
                    List.of(),
                    null
            );
        }

        ParameterLookup parameterLookup = buildParameterLookup(resolvedParameters, rawInputs);
        String rawContent = resolvedContent.content();
        if (isTransfer) {
            TransferRenderResult transferResult = renderTransferSnapshot(rawContent, parameterLookup);
            return new OperationsExecutionNodeSnapshotResponse(
                    execution.id(),
                    node.taskId(),
                    kind,
                    node.dataSourceType(),
                    node.dataSourceId(),
                    dataSourceName,
                    filePath,
                    resolvedContent.snapshotSource(),
                    resolvedContent.commitSha(),
                    resolvedContent.exactSnapshot(),
                    resolvedContent.notice(),
                    true,
                    rawContent,
                    null,
                    transferResult.renderNote(),
                    transferResult.renderError(),
                    transferResult.referencedParameters(),
                    transferResult.transfer()
            );
        }

        ScriptRenderResult scriptResult = renderScriptSnapshot(kind, node.dataSourceType(), rawContent, parameterLookup);
        return new OperationsExecutionNodeSnapshotResponse(
                execution.id(),
                node.taskId(),
                kind,
                node.dataSourceType(),
                node.dataSourceId(),
                dataSourceName,
                filePath,
                resolvedContent.snapshotSource(),
                resolvedContent.commitSha(),
                resolvedContent.exactSnapshot(),
                resolvedContent.notice(),
                true,
                rawContent,
                scriptResult.renderedContent(),
                scriptResult.renderNote(),
                scriptResult.renderError(),
                scriptResult.referencedParameters(),
                null
        );
    }

    @Nullable
    private String loadExecutionFlowSource(KestraExecutionSnapshot execution) {
        Integer revision = execution.flowRevision();
        if (revision != null && revision > 0) {
            try {
                String source = kestraClient.getFlowSource(execution.namespace(), execution.flowId(), revision);
                if (hasNonBlank(source)) {
                    return source;
                }
            } catch (RuntimeException ex) {
                log.debug("按执行版本读取 Flow 失败，降级读取当前线上版本: namespace={}, flowId={}, revision={}, message={}",
                        execution.namespace(), execution.flowId(), revision, ex.getMessage());
            }
        }
        try {
            String source = kestraClient.getFlowSource(execution.namespace(), execution.flowId());
            return hasNonBlank(source) ? source : null;
        } catch (RuntimeException ex) {
            log.debug("读取 Flow 源码失败: namespace={}, flowId={}, message={}",
                    execution.namespace(), execution.flowId(), ex.getMessage());
            return null;
        }
    }

    private ResolvedContent resolveNodeFileContent(Long groupId,
                                                   KestraExecutionSnapshot execution,
                                                   @Nullable String branch,
                                                   @Nullable String filePath) {
        if (!hasNonBlank(filePath)) {
            return new ResolvedContent(
                    SOURCE_UNAVAILABLE, null, false,
                    "该节点未绑定脚本或传输配置文件。",
                    false, null
            );
        }
        String normalizedPath = normalizeRelativePath(filePath);
        String commitSha = resolveExecutionCommitSha(groupId, execution, branch);
        if (commitSha != null && gitCommandService != null) {
            try {
                String gitContent = gitCommandService.readFileAtRevision(groupId, commitSha, normalizedPath);
                if (gitContent != null) {
                    return new ResolvedContent(SOURCE_EXECUTION_COMMIT, commitSha, true, null, true, gitContent);
                }
            } catch (RuntimeException ex) {
                log.debug("按提交读取节点快照失败，尝试降级到 Kestra 命名空间文件: groupId={}, sha={}, path={}, message={}",
                        groupId, commitSha, normalizedPath, ex.getMessage());
            }
        }

        try {
            String onlineContent = kestraClient.getNamespaceFile(execution.namespace(), normalizedPath);
            if (onlineContent != null) {
                return new ResolvedContent(
                        SOURCE_CURRENT_ONLINE,
                        commitSha,
                        false,
                        "未能定位本次执行对应的历史代码提交，当前展示线上最新内容。",
                        true,
                        onlineContent
                );
            }
        } catch (RuntimeException ex) {
            log.debug("读取 Kestra 命名空间文件失败: namespace={}, path={}, message={}",
                    execution.namespace(), normalizedPath, ex.getMessage());
        }

        return new ResolvedContent(
                SOURCE_UNAVAILABLE,
                commitSha,
                false,
                "无法读取该节点的脚本内容（文件可能已被删除或尚未同步）。",
                false,
                null
        );
    }

    @Nullable
    private String resolveExecutionCommitSha(Long groupId,
                                             KestraExecutionSnapshot execution,
                                             @Nullable String branch) {
        String labelRevision = execution.labels() == null ? null : execution.labels().get("wbdataSourceRevision");
        if (isValidSha(labelRevision)) {
            return labelRevision.trim();
        }
        if (groupId == null || !hasNonBlank(branch)) {
            return null;
        }
        Instant execTime = execution.startDate() != null ? execution.startDate() : execution.createdAt();
        if (execTime == null) {
            return null;
        }
        try {
            Map<String, String> filters = new LinkedHashMap<>();
            filters.put("filters[namespace][EQUALS]", "system");
            filters.put("filters[flowId][EQUALS]", GitSyncFlowSourceBuilder.buildSyncFlowId(groupId, branch.trim()));
            filters.put("filters[state][EQUALS]", "SUCCESS");
            filters.put("filters[startDate][LESS_THAN_OR_EQUAL_TO]",
                    DateTimeFormatter.ISO_INSTANT.format(execTime.truncatedTo(ChronoUnit.MILLIS)));
            KestraExecutionPage page = kestraClient.searchExecutionsPage(filters, 1, 5, "state.startDate:desc");
            if (page == null || page.results() == null || page.results().isEmpty()) {
                return null;
            }
            for (KestraExecutionSnapshot syncExec : page.results()) {
                if (syncExec == null) {
                    continue;
                }
                Instant completedAt = syncExec.endDate() != null ? syncExec.endDate() : syncExec.startDate();
                if (completedAt != null && completedAt.isAfter(execTime)) {
                    continue;
                }
                Map<String, String> outputs = syncExec.outputs();
                if (outputs == null || outputs.isEmpty()) {
                    continue;
                }
                String endSha = outputs.get("end_sha");
                String startSha = outputs.get("start_sha");
                String candidate = hasNonBlank(endSha) ? endSha.trim() : (hasNonBlank(startSha) ? startSha.trim() : null);
                if (isValidSha(candidate)) {
                    return candidate;
                }
            }
            return null;
        } catch (RuntimeException ex) {
            log.debug("查询同步执行记录以定位提交失败: groupId={}, branch={}, message={}",
                    groupId, branch, ex.getMessage());
            return null;
        }
    }

    private ScriptRenderResult renderScriptSnapshot(String kind,
                                                    @Nullable String dataSourceType,
                                                    String rawContent,
                                                    ParameterLookup parameterLookup) {
        if (OfflineFlowInspector.isJdbcSqlKind(kind)) {
            String dbType = firstNonBlank(dataSourceType, kind, "MYSQL");
            try {
                SqlParameterTemplate.Compilation compilation = SqlParameterTemplate.compile(rawContent);
                List<String> referencedNames = new ArrayList<>(new LinkedHashSet<>(compilation.parameterNames()));
                List<ExecutionParameterValueResponse> referencedParams = parameterLookup.resolveList(referencedNames);
                if (referencedNames.isEmpty()) {
                    return new ScriptRenderResult(rawContent, null, null, List.of());
                }
                String rendered = SqlParameterTemplate.render(rawContent, name -> {
                    String value = parameterLookup.values().get(name);
                    if (value == null) {
                        throw new IllegalArgumentException("SQL 引用了未提供值的参数: " + name);
                    }
                    return formatSqlPreviewLiteral(value);
                });
                return new ScriptRenderResult(
                        rendered,
                        "参数已按本次执行实际值代入预览（JDBC 运行时通过 PreparedStatement 绑定参数执行）。",
                        null,
                        referencedParams
                );
            } catch (IllegalArgumentException ex) {
                return new ScriptRenderResult(null, null, ex.getMessage(), List.of());
            }
        }

        if ("HIVE_SQL".equals(kind)) {
            try {
                Set<String> referencedNames = ScriptParameterRenderer.hiveReferences(rawContent, parameterLookup.allKeys());
                List<ExecutionParameterValueResponse> referencedParams = parameterLookup.resolveList(referencedNames);
                if (referencedNames.isEmpty()) {
                    return new ScriptRenderResult(rawContent, null, null, List.of());
                }
                String rendered = ScriptParameterRenderer.renderHive(rawContent, parameterLookup.values());
                return new ScriptRenderResult(
                        rendered,
                        "参数已按本次执行实际值与 HiveSQL 运行时规则渲染。",
                        null,
                        referencedParams
                );
            } catch (IllegalArgumentException ex) {
                Set<String> fallbackRefs = safeHiveReferences(rawContent, parameterLookup.allKeys());
                return new ScriptRenderResult(
                        null,
                        null,
                        ex.getMessage(),
                        parameterLookup.resolveList(fallbackRefs)
                );
            }
        }

        try {
            Set<String> referencedNames = ScriptParameterRenderer.shellReferences(rawContent, parameterLookup.allKeys());
            List<ExecutionParameterValueResponse> referencedParams = parameterLookup.resolveList(referencedNames);
            if (referencedNames.isEmpty()) {
                return new ScriptRenderResult(rawContent, null, null, List.of());
            }
            List<String> missingValues = referencedNames.stream()
                    .filter(name -> parameterLookup.values().get(name) == null)
                    .toList();
            if (!missingValues.isEmpty()) {
                return new ScriptRenderResult(
                        null,
                        null,
                        "Shell 引用了未提供值的参数: " + String.join(", ", missingValues),
                        referencedParams
                );
            }
            String rendered = ScriptParameterRenderer.renderShell(rawContent, parameterLookup.values());
            return new ScriptRenderResult(
                    rendered,
                    "参数已按本次执行实际值与 Shell 单引号规则渲染。",
                    null,
                    referencedParams
            );
        } catch (IllegalArgumentException ex) {
            return new ScriptRenderResult(null, null, ex.getMessage(), List.of());
        }
    }

    private Set<String> safeHiveReferences(String rawContent, Set<String> allKeys) {
        try {
            return ScriptParameterRenderer.hiveReferences(rawContent, allKeys);
        } catch (RuntimeException ex) {
            return Set.of();
        }
    }

    private TransferRenderResult renderTransferSnapshot(String rawContent, ParameterLookup parameterLookup) {
        TransferConfig config;
        String fallbackWriteMode = null;
        try {
            JsonNode root = objectMapper.readTree(rawContent);
            fallbackWriteMode = root.path("writeMode").asText(null);
            config = objectMapper.readerFor(TransferConfig.class)
                    .without(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                    .readValue(root);
        } catch (IOException | IllegalArgumentException ex) {
            return new TransferRenderResult(
                    null,
                    null,
                    "解析传输配置失败: " + ex.getMessage(),
                    List.of()
            );
        }

        TransferEndpointConfig source = config.source();
        TransferEndpointConfig target = config.target();
        String sourceType = source != null ? source.dataSourceType() : null;
        String targetType = target != null ? target.dataSourceType() : null;
        String effectiveWriteMode = target != null && target.writeMode() != null
                ? target.writeMode().value()
                : fallbackWriteMode;

        Set<String> referencedNames = Set.of();
        String renderError = null;
        try {
            referencedNames = TransferParameters.references(config);
            TransferParameters.requireValues(config, parameterLookup.values());
        } catch (IllegalArgumentException ex) {
            renderError = ex.getMessage();
        }

        List<ExecutionParameterValueResponse> referencedParams = parameterLookup.resolveList(referencedNames);
        boolean canRender = renderError == null;

        String whereRaw = source != null ? source.where() : null;
        String whereRendered = canRender && hasNonBlank(whereRaw)
                ? renderSqlSafe(whereRaw, sourceType, parameterLookup.values())
                : null;

        OperationsTransferSnapshot.EndpointView sourceView = source == null ? null : new OperationsTransferSnapshot.EndpointView(
                source.dataSourceId(),
                resolveDataSourceName(source.dataSourceId()),
                source.dataSourceType(),
                source.database(),
                source.table(),
                whereRaw,
                whereRendered
        );

        OperationsTransferSnapshot.EndpointView targetView = target == null ? null : new OperationsTransferSnapshot.EndpointView(
                target.dataSourceId(),
                resolveDataSourceName(target.dataSourceId()),
                target.dataSourceType(),
                target.database(),
                target.table(),
                null,
                null
        );

        List<OperationsTransferSnapshot.MappingView> fieldMappings = mapFields(
                config.fieldMappings(), sourceType, parameterLookup.values(), canRender);
        List<OperationsTransferSnapshot.MappingView> partitions = mapPartitions(
                config.partitions(), sourceType, parameterLookup.values(), canRender);

        List<String> preSqlRaw = target != null && target.preSql() != null ? List.copyOf(target.preSql()) : List.of();
        List<String> postSqlRaw = target != null && target.postSql() != null ? List.copyOf(target.postSql()) : List.of();
        List<String> preSqlRendered = canRender
                ? renderSqlListSafe(preSqlRaw, targetType, parameterLookup.values())
                : List.of();
        List<String> postSqlRendered = canRender
                ? renderSqlListSafe(postSqlRaw, targetType, parameterLookup.values())
                : List.of();

        OperationsTransferSnapshot transferSnapshot = new OperationsTransferSnapshot(
                sourceView,
                targetView,
                effectiveWriteMode,
                fieldMappings,
                partitions,
                preSqlRaw,
                preSqlRendered,
                postSqlRaw,
                postSqlRendered
        );

        String renderNote = !referencedNames.isEmpty() && canRender
                ? "传输条件、静态值与前后置 SQL 已按本次执行参数值渲染。"
                : null;

        return new TransferRenderResult(transferSnapshot, renderNote, renderError, referencedParams);
    }

    private List<OperationsTransferSnapshot.MappingView> mapFields(@Nullable List<TransferFieldMapping> mappings,
                                                                   @Nullable String sourceType,
                                                                   Map<String, String> paramValues,
                                                                   boolean canRender) {
        if (mappings == null || mappings.isEmpty()) {
            return List.of();
        }
        List<OperationsTransferSnapshot.MappingView> result = new ArrayList<>(mappings.size());
        for (TransferFieldMapping mapping : mappings) {
            if (mapping == null) {
                continue;
            }
            result.add(toMappingView(
                    mapping.target(),
                    mapping.kind(),
                    mapping.source(),
                    mapping.expression(),
                    mapping.value(),
                    sourceType,
                    paramValues,
                    canRender
            ));
        }
        return List.copyOf(result);
    }

    private List<OperationsTransferSnapshot.MappingView> mapPartitions(@Nullable List<TransferPartitionMapping> mappings,
                                                                       @Nullable String sourceType,
                                                                       Map<String, String> paramValues,
                                                                       boolean canRender) {
        if (mappings == null || mappings.isEmpty()) {
            return List.of();
        }
        List<OperationsTransferSnapshot.MappingView> result = new ArrayList<>(mappings.size());
        for (TransferPartitionMapping mapping : mappings) {
            if (mapping == null) {
                continue;
            }
            result.add(toMappingView(
                    mapping.target(),
                    mapping.kind(),
                    mapping.source(),
                    mapping.expression(),
                    mapping.value(),
                    sourceType,
                    paramValues,
                    canRender
            ));
        }
        return List.copyOf(result);
    }

    private OperationsTransferSnapshot.MappingView toMappingView(String target,
                                                                 @Nullable TransferMappingKind kind,
                                                                 @Nullable String source,
                                                                 @Nullable String expressionRaw,
                                                                 @Nullable String valueRaw,
                                                                 @Nullable String sourceType,
                                                                 Map<String, String> paramValues,
                                                                 boolean canRender) {
        String expressionRendered = canRender && kind == TransferMappingKind.SOURCE_EXPRESSION && hasNonBlank(expressionRaw)
                ? renderSqlSafe(expressionRaw, sourceType, paramValues)
                : null;
        String valueRendered = canRender && kind == TransferMappingKind.STATIC_VALUE && valueRaw != null
                ? renderTextSafe(valueRaw, paramValues)
                : null;
        return new OperationsTransferSnapshot.MappingView(
                target,
                kind != null ? kind.value() : null,
                source,
                expressionRaw,
                expressionRendered,
                valueRaw,
                valueRendered
        );
    }

    @Nullable
    private String renderSqlSafe(String sql, @Nullable String dbType, Map<String, String> paramValues) {
        try {
            return SqlParameterTemplate.render(sql, name -> {
                String value = paramValues.get(name);
                if (value == null) {
                    throw new IllegalArgumentException("缺少参数值: " + name);
                }
                return formatSqlPreviewLiteral(value);
            });
        } catch (RuntimeException ex) {
            return null;
        }
    }

    private String formatSqlPreviewLiteral(String value) {
        return "'" + value.replace("'", "''") + "'";
    }

    @Nullable
    private String renderTextSafe(String text, Map<String, String> paramValues) {
        try {
            return TransferParameters.renderText(text, paramValues);
        } catch (RuntimeException ex) {
            return null;
        }
    }

    private List<String> renderSqlListSafe(List<String> statements,
                                           @Nullable String dbType,
                                           Map<String, String> paramValues) {
        if (statements.isEmpty()) {
            return List.of();
        }
        return statements.stream()
                .map(stmt -> {
                    String rendered = renderSqlSafe(stmt, dbType, paramValues);
                    return rendered != null ? rendered : stmt;
                })
                .toList();
    }

    private ParameterLookup buildParameterLookup(List<ExecutionParameterValueResponse> resolvedParameters,
                                                 Map<String, String> rawInputs) {
        Map<String, ExecutionParameterValueResponse> metaByKey = new LinkedHashMap<>();
        Map<String, String> values = new LinkedHashMap<>();
        if (rawInputs != null) {
            rawInputs.forEach((key, value) -> {
                if (hasNonBlank(key) && value != null) {
                    values.put(key, value);
                    metaByKey.putIfAbsent(key, new ExecutionParameterValueResponse(key, "STRING", value, "EXPLICIT_INPUT"));
                }
            });
        }
        if (resolvedParameters != null) {
            for (ExecutionParameterValueResponse param : resolvedParameters) {
                if (param == null || !hasNonBlank(param.key())) {
                    continue;
                }
                metaByKey.put(param.key(), param);
                if (param.value() != null) {
                    values.put(param.key(), param.value());
                }
            }
        }
        return new ParameterLookup(values, metaByKey);
    }

    @Nullable
    private String resolveDataSourceName(@Nullable Long dataSourceId) {
        if (dataSourceMapper == null || dataSourceId == null) {
            return null;
        }
        try {
            DataSource dataSource = dataSourceMapper.selectById(dataSourceId);
            return dataSource != null ? dataSource.getName() : null;
        } catch (RuntimeException ex) {
            return null;
        }
    }

    private String normalizeKind(@Nullable String kind) {
        if (kind == null || kind.isBlank()) {
            return "SHELL";
        }
        return kind.trim().toUpperCase(Locale.ROOT);
    }

    private String normalizeRelativePath(String path) {
        String normalized = path.trim().replace('\\', '/');
        while (normalized.startsWith("/")) {
            normalized = normalized.substring(1);
        }
        return normalized;
    }

    private boolean isValidSha(@Nullable String value) {
        return value != null && GIT_SHA_PATTERN.matcher(value.trim()).matches();
    }

    private boolean hasNonBlank(@Nullable String value) {
        return value != null && !value.isBlank();
    }

    private String firstNonBlank(String... candidates) {
        for (String candidate : candidates) {
            if (hasNonBlank(candidate)) {
                return candidate.trim().toUpperCase(Locale.ROOT);
            }
        }
        return "MYSQL";
    }

    record ExecutionGraphResult(
            List<OperationsExecutionGraphNode> nodes,
            List<OperationsRerunGraphEdge> edges
    ) {
        static ExecutionGraphResult empty() {
            return new ExecutionGraphResult(List.of(), List.of());
        }
    }

    private record ResolvedContent(
            String snapshotSource,
            @Nullable String commitSha,
            boolean exactSnapshot,
            @Nullable String notice,
            boolean contentAvailable,
            @Nullable String content
    ) {
    }

    private record ScriptRenderResult(
            @Nullable String renderedContent,
            @Nullable String renderNote,
            @Nullable String renderError,
            List<ExecutionParameterValueResponse> referencedParameters
    ) {
    }

    private record TransferRenderResult(
            @Nullable OperationsTransferSnapshot transfer,
            @Nullable String renderNote,
            @Nullable String renderError,
            List<ExecutionParameterValueResponse> referencedParameters
    ) {
    }

    private record ParameterLookup(
            Map<String, String> values,
            Map<String, ExecutionParameterValueResponse> metaByKey
    ) {
        Set<String> allKeys() {
            return metaByKey.keySet();
        }

        List<ExecutionParameterValueResponse> resolveList(Iterable<String> names) {
            List<ExecutionParameterValueResponse> list = new ArrayList<>();
            Set<String> seen = new LinkedHashSet<>();
            for (String name : names) {
                if (!seen.add(name)) {
                    continue;
                }
                ExecutionParameterValueResponse meta = metaByKey.get(name);
                if (meta != null) {
                    list.add(meta);
                } else {
                    list.add(new ExecutionParameterValueResponse(name, "STRING", values.get(name), "UNAVAILABLE"));
                }
            }
            return List.copyOf(list);
        }
    }
}
