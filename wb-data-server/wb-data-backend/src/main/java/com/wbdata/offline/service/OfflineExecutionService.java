package com.wbdata.offline.service;

import com.wbdata.offline.config.OfflineKestraProperties;
import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.config.OfflineTransferProperties;
import com.wbdata.offline.config.TransferRunner;
import com.wbdata.offline.dto.DebugExecutionRequest;
import com.wbdata.offline.dto.FlowParameterSnapshot;
import com.wbdata.offline.dto.OfflineExecutionDetailResponse;
import com.wbdata.offline.dto.OfflineExecutionListItem;
import com.wbdata.offline.dto.ExecutionLogEntry;
import com.wbdata.offline.dto.ExecutionTaskRun;
import com.wbdata.offline.dto.OfflineExecutionResponse;
import com.wbdata.offline.dto.OfflineExecutionScriptResponse;
import com.wbdata.offline.kestra.KestraClient;
import com.wbdata.offline.kestra.KestraExecutionSnapshot;
import com.wbdata.offline.kestra.KestraLogEntry;
import com.wbdata.offline.kestra.KestraTaskRunSnapshot;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
@RequiredArgsConstructor
public class OfflineExecutionService {

    private static final String TRANSFER_DOCKER_TASK_RUNNER_TYPE = "io.kestra.plugin.scripts.runner.docker.Docker";

    private final KestraClient kestraClient;
    private final OfflineKestraProperties offlineKestraProperties;
    private final OfflineProperties offlineProperties;
    private final OfflineRepoStatusService offlineRepoStatusService;
    private final FlowParameterSnapshotStore parameterSnapshotStore;
    private final ExecutionParameterSnapshotRegistry executionParameterSnapshotRegistry;
    private final OfflineTransferProperties transferProperties;
    private final OfflineFlowYamlSupport yamlSupport = new OfflineFlowYamlSupport();
    private final ExecutionParameterResolver parameterResolver = new ExecutionParameterResolver();

    public OfflineExecutionResponse createDebugExecution(DebugExecutionRequest request, Long requestedBy) {
        return createDebugExecution(request, Collections.emptyMap(), requestedBy);
    }

    public OfflineExecutionResponse createDebugExecution(DebugExecutionRequest request,
                                                         Map<String, String> namespaceFileOverrides,
                                                         Long requestedBy) {
        FlowParameterSnapshot parameterSnapshot = resolveParameterSnapshot(request);
        Map<String, String> overrides = parameterResolver.resolveOverrides(
                parameterSnapshot, request.parameterOverrides());
        Set<String> actualSelectedTaskIds = getActualSelectedTaskIds(request);
        validateSelectedTaskTypes(request, actualSelectedTaskIds);
        String sourceRevision = yamlSupport.sha256Hex(request.content());
        String branch = readCurrentBranch(request.groupId());
        String debugNamespace = offlineKestraProperties.buildDebugNamespace(request.groupId(), requestedBy, branch);
        OfflineFlowYamlSupport.FlowIdentity identity = yamlSupport.parseIdentity(request.content());
        String debugFlow = yamlSupport.buildDebugFlow(
                request.content(),
                debugNamespace,
                request.flowPath(),
                request.groupId(),
                requestedBy,
                branch,
                sourceRevision,
                request.mode(),
                new java.util.ArrayList<>(actualSelectedTaskIds),
                overrides.keySet()
        );
        Map<String, String> inputs = buildExecutionInputs(
                request, parameterSnapshot, overrides);

        syncNamespaceFiles(request.groupId(), request.content(), debugNamespace, namespaceFileOverrides);
        kestraClient.upsertFlow(debugFlow);
        KestraExecutionSnapshot execution = inputs.isEmpty()
                ? kestraClient.createExecution(debugNamespace, identity.flowId())
                : kestraClient.createExecution(debugNamespace, identity.flowId(), inputs);
        return new OfflineExecutionResponse(
                execution.id(),
                "DEBUG",
                request.flowPath(),
                sourceRevision,
                execution.status(),
                execution.createdAt()
        );
    }

    private FlowParameterSnapshot resolveParameterSnapshot(DebugExecutionRequest request) {
        String snapshotId = yamlSupport.readLabel(
                request.content(), ExecutionParameterSnapshotRegistry.LABEL_KEY);
        if (snapshotId != null) {
            return executionParameterSnapshotRegistry.find(request.groupId(), snapshotId)
                    .orElseThrow(() -> new ResponseStatusException(
                            HttpStatus.BAD_REQUEST, "任务引用的执行参数快照不存在"));
        }
        Path repoPath = offlineProperties.resolveRepoPath(request.groupId());
        try {
            return parameterSnapshotStore.read(repoPath, request.flowPath())
                    .map(FlowParameterSnapshotStore.SnapshotFile::snapshot)
                    .orElse(null);
        } catch (IOException ex) {
            throw new IllegalStateException("读取任务参数快照失败", ex);
        }
    }

    private Map<String, String> buildExecutionInputs(DebugExecutionRequest request,
                                                     FlowParameterSnapshot snapshot,
                                                     Map<String, String> overrides) {
        Map<String, String> inputs = new LinkedHashMap<>(overrides);
        if (!requiresPlannedTimeContext(snapshot)) {
            return Collections.unmodifiableMap(inputs);
        }
        if (request.plannedTime() == null) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST, "当前任务 包含计划时间参数，请选择参考计划时间");
        }
        ZoneId runtimeZone = resolveRuntimeZone(snapshot);
        List<ZoneOffset> validOffsets = runtimeZone.getRules().getValidOffsets(request.plannedTime());
        if (validOffsets.size() != 1) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST, "参考计划时间在运行时区中不存在或不唯一，请换一个时间");
        }
        Instant plannedTime = request.plannedTime().atOffset(validOffsets.getFirst()).toInstant();
        inputs.put(ExecutionTimeContext.PLANNED_TIME_INPUT, plannedTime.toString());
        return Collections.unmodifiableMap(inputs);
    }

    private boolean requiresPlannedTimeContext(FlowParameterSnapshot snapshot) {
        if (snapshot == null) {
            return false;
        }
        return snapshot.definitions().stream()
                .anyMatch(definition -> "SYSTEM_TIME".equals(definition.valueSource())
                        && "PLANNED_TIME".equals(
                                definition.timeBasis() == null ? "PLANNED_TIME" : definition.timeBasis()));
    }

    private ZoneId resolveRuntimeZone(FlowParameterSnapshot snapshot) {
        if (snapshot == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "当前任务 缺少参数快照");
        }
        if (snapshot.runtimeTimezone() == null || snapshot.runtimeTimezone().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "当前任务 缺少运行时区");
        }
        try {
            return ZoneId.of(snapshot.runtimeTimezone());
        } catch (RuntimeException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "任务运行时区不合法");
        }
    }

    private Set<String> getActualSelectedTaskIds(DebugExecutionRequest request) {
        if (!"ALL".equalsIgnoreCase(request.mode()) && request.selectedTaskIds() != null && !request.selectedTaskIds().isEmpty()) {
            return new LinkedHashSet<>(request.selectedTaskIds());
        }
        OfflineFlowYamlSupport.FlowGraph graph = yamlSupport.parseGraph(request.content());
        return graph.nodes().stream()
                .map(OfflineFlowNode::taskId)
                .collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new));
    }

    private void validateSelectedTaskTypes(DebugExecutionRequest request, Set<String> selectedTaskIds) {
        OfflineFlowYamlSupport.FlowGraph graph = yamlSupport.parseGraph(request.content());
        for (OfflineFlowNode node : graph.nodes()) {
            if (!selectedTaskIds.contains(node.taskId())) {
                continue;
            }
            if ("TRANSFER".equalsIgnoreCase(node.kind())) {
                validateTransferTaskRunner(node.taskId());
                continue;
            }
            if (!"SQL".equalsIgnoreCase(node.kind())) {
                continue;
            }
            if (node.dataSourceType() == null || node.dataSourceType().isBlank()) {
                continue;
            }
            if ("HIVE".equalsIgnoreCase(node.dataSourceType())) {
                throw new ResponseStatusException(
                        HttpStatus.BAD_REQUEST,
                        "SQL 节点不再支持 Hive 数据源，节点 " + node.taskId() + " 请改用 HiveSQL 节点"
                );
            }

            String taskType = OfflineNodeTaskCompiler.resolveKestraQueryTaskType(node.dataSourceType());
            if (!kestraClient.supportsTaskType(taskType)) {
                throw new ResponseStatusException(
                        HttpStatus.BAD_REQUEST,
                        "当前 Kestra 未安装 " + node.dataSourceType() + " 执行插件，节点 " + node.taskId() + " 暂时无法执行"
                );
            }
        }
    }

    private void validateTransferTaskRunner(String taskId) {
        if (transferProperties.getRunner() != TransferRunner.DOCKER) {
            return;
        }
        if (!kestraClient.supportsTaskType(TRANSFER_DOCKER_TASK_RUNNER_TYPE)) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "当前 Kestra 不支持 Docker task runner，传输节点 " + taskId + " 暂时无法执行"
            );
        }
    }

    public List<OfflineExecutionListItem> listExecutions(Long groupId, String flowPath) {
        return listExecutions(groupId, flowPath, null);
    }

    public List<OfflineExecutionListItem> listExecutions(Long groupId, String flowPath, Long requestedBy) {
        String branch = readCurrentBranch(groupId);
        return kestraClient.searchExecutions(buildExecutionSearchFilters(groupId, flowPath, requestedBy, branch)).stream()
                .filter(execution -> matchesRequestedBy(execution, requestedBy))
                .filter(execution -> matchesBranch(execution, branch))
                .sorted(Comparator.comparing(KestraExecutionSnapshot::createdAt).reversed())
                .map(this::toListItem)
                .toList();
    }

    public OfflineExecutionDetailResponse getExecution(Long groupId, String executionId) {
        KestraExecutionSnapshot execution = kestraClient.getExecution(executionId);
        ensureExecutionAccessible(execution, groupId);
        
        java.util.List<ExecutionTaskRun> taskRuns = new java.util.ArrayList<>();
        Set<String> seenTaskIds = new LinkedHashSet<>();

        if (execution.taskRuns() != null) {
            for (KestraTaskRunSnapshot taskRun : execution.taskRuns()) {
                seenTaskIds.add(taskRun.taskId());
                taskRuns.add(ExecutionTaskRun.of(
                        taskRun.taskId(),
                        taskRun.status(),
                        taskRun.startDate(),
                        taskRun.endDate()
                ));
            }
        }

        Map<String, String> labels = labels(execution);
        String targetNodesStr = labels.get("wbdataSelectedTaskIds");
        if (targetNodesStr != null && !targetNodesStr.isBlank()) {
            for (String targetNode : targetNodesStr.split("---")) {
                String taskId = targetNode.trim();
                if (!taskId.isEmpty() && !seenTaskIds.contains(taskId)) {
                    taskRuns.add(ExecutionTaskRun.of(
                            taskId,
                            "QUEUED",
                            null,
                            null
                    ));
                }
            }
        }

        ExecutionParameterResolver.Resolution parameterResolution = resolveExecutionParameters(
                groupId, execution, labels);
        return new OfflineExecutionDetailResponse(
                execution.id(),
                labels.getOrDefault("wbdataMode", "DEBUG"),
                labels.get("wbdataFlowPath"),
                parseRequestedBy(execution),
                labels.get("wbdataBranch"),
                labels.get("wbdataSourceRevision"),
                execution.status(),
                execution.createdAt(),
                execution.startDate(),
                execution.endDate(),
                taskRuns,
                parameterResolution == null ? parameterResolutionStatus(execution) : parameterResolution.status(),
                parameterResolution == null ? List.of() : parameterResolution.parameters()
        );
    }

    private ExecutionParameterResolver.Resolution resolveExecutionParameters(Long groupId,
                                                                              KestraExecutionSnapshot execution,
                                                                              Map<String, String> executionLabels) {
        String snapshotId = executionLabels.get(ExecutionParameterSnapshotRegistry.LABEL_KEY);
        if (snapshotId == null || snapshotId.isBlank()) {
            return null;
        }
        var snapshot = executionParameterSnapshotRegistry.find(groupId, snapshotId).orElse(null);
        if (snapshot == null) {
            return null;
        }
        Set<String> overrideKeys = splitLabelValues(executionLabels.get("wbdataParameterOverrideKeys"));
        return parameterResolver.resolveExecution(
                snapshot,
                execution.inputs(),
                new ExecutionTimeContext(readPlannedTime(execution), execution.startDate()),
                overrideKeys);
    }

    private Instant readPlannedTime(KestraExecutionSnapshot execution) {
        String input = execution.inputs() == null
                ? null
                : execution.inputs().get(ExecutionTimeContext.PLANNED_TIME_INPUT);
        if (input == null || input.isBlank()) {
            return execution.plannedAt();
        }
        try {
            return Instant.parse(input);
        } catch (DateTimeParseException ex) {
            return null;
        }
    }

    private String parameterResolutionStatus(KestraExecutionSnapshot execution) {
        return execution.inputs() == null || execution.inputs().isEmpty() ? "NONE" : "UNAVAILABLE";
    }

    private Set<String> splitLabelValues(String value) {
        if (value == null || value.isBlank()) {
            return Set.of();
        }
        return java.util.Arrays.stream(value.split("---"))
                .map(String::trim)
                .filter(item -> !item.isEmpty())
                .collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new));
    }

    public OfflineExecutionScriptResponse getExecutionScript(Long groupId, String executionId) {
        KestraExecutionSnapshot execution = kestraClient.getExecution(executionId);
        ensureExecutionAccessible(execution, groupId);
        return new OfflineExecutionScriptResponse(
                execution.id(),
                labels(execution).get("wbdataFlowPath"),
                kestraClient.getFlowSource(execution.namespace(), execution.flowId())
        );
    }

    public List<ExecutionLogEntry> getExecutionLogs(Long groupId, String executionId, String taskId) {
        ensureExecutionAccessible(kestraClient.getExecution(executionId), groupId);
        return kestraClient.getLogs(executionId, taskId).stream()
                .map(entry -> new ExecutionLogEntry(entry.timestamp(), entry.taskId(), entry.level(), entry.message()))
                .toList();
    }

    public void stopExecution(Long groupId, String executionId) {
        ensureExecutionAccessible(kestraClient.getExecution(executionId), groupId);
        kestraClient.killExecution(executionId);
    }

    public int stopAllExecutions(Long groupId, String flowPath) {
        int stoppedCount = 0;
        String branch = readCurrentBranch(groupId);
        for (KestraExecutionSnapshot execution : kestraClient.searchExecutions(buildExecutionSearchFilters(groupId, flowPath, null, branch))) {
            if (isRunning(execution.status()) && matchesBranch(execution, branch)) {
                kestraClient.killExecution(execution.id());
                stoppedCount++;
            }
        }
        return stoppedCount;
    }

    private void syncNamespaceFiles(Long groupId,
                                    String source,
                                    String debugNamespace,
                                    Map<String, String> namespaceFileOverrides) {
        java.util.Set<String> namespaceFiles = new java.util.LinkedHashSet<>(yamlSupport.collectNamespaceFiles(source));
        namespaceFiles.addAll(namespaceFileOverrides.keySet());
        if (namespaceFiles.isEmpty()) {
            return;
        }

        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        for (String file : namespaceFiles) {
            String overriddenContent = namespaceFileOverrides.get(file);
            if (overriddenContent != null) {
                kestraClient.upsertNamespaceFile(debugNamespace, ensureLeadingSlash(file), overriddenContent);
                continue;
            }
            Path resolvedPath = resolveRepoFile(repoPath, file);
            if (!Files.isRegularFile(resolvedPath)) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "脚本文件不存在: " + file);
            }
            try {
                kestraClient.upsertNamespaceFile(debugNamespace, ensureLeadingSlash(file), Files.readString(resolvedPath, StandardCharsets.UTF_8));
            } catch (IOException ex) {
                throw new IllegalStateException("读取脚本文件失败", ex);
            }
        }
    }

    private Path resolveRepoFile(Path repoPath, String path) {
        if (path == null || path.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "脚本文件路径不能为空");
        }
        Path relativePath = Path.of(path).normalize();
        if (relativePath.isAbsolute()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "脚本文件路径不合法");
        }

        Path resolvedPath = repoPath.resolve(relativePath).normalize();
        if (!resolvedPath.startsWith(repoPath)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "脚本文件路径不合法");
        }
        return resolvedPath;
    }

    private String ensureLeadingSlash(String path) {
        return path.startsWith("/") ? path : "/" + path;
    }

    private OfflineExecutionListItem toListItem(KestraExecutionSnapshot execution) {
        Long durationMs = null;
        if (execution.startDate() != null && execution.endDate() != null) {
            durationMs = execution.endDate().toEpochMilli() - execution.startDate().toEpochMilli();
        }
        return new OfflineExecutionListItem(
                execution.id(),
                labels(execution).get("wbdataFlowPath"),
                readExecutionDisplayName(execution),
                parseRequestedBy(execution),
                labels(execution).getOrDefault("wbdataMode", "DEBUG"),
                execution.status(),
                "MANUAL",
                execution.startDate(),
                execution.endDate(),
                durationMs,
                labels(execution).get("wbdataSourceRevision")
        );
    }

    private String readExecutionDisplayName(KestraExecutionSnapshot execution) {
        return execution.id();
    }

    private boolean isRunning(String status) {
        return "RUNNING".equals(status)
                || "CREATED".equals(status)
                || "QUEUED".equals(status)
                || "PAUSED".equals(status);
    }

    private Map<String, String> buildExecutionSearchFilters(Long groupId, String flowPath, Long requestedBy, String branch) {
        Map<String, String> filters = new java.util.LinkedHashMap<>();
        if (requestedBy != null) {
            filters.put("filters[namespace][EQUALS]", offlineKestraProperties.buildDebugNamespace(groupId, requestedBy, branch));
        } else {
            filters.put("filters[namespace][CONTAINS]", offlineKestraProperties.buildDebugNamespacePrefix(groupId));
        }
        filters.put("filters[labels][EQUALS][wbdataMode]", "DEBUG");
        filters.put("filters[labels][EQUALS][wbdataFlowPath]", flowPath);
        filters.put("filters[labels][EQUALS][wbdataBranch]", branch);
        return filters;
    }

    private void ensureExecutionAccessible(KestraExecutionSnapshot execution, Long groupId) {
        if (!belongsToGroup(execution, groupId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "执行记录不存在");
        }
    }

    private boolean belongsToGroup(KestraExecutionSnapshot execution, Long groupId) {
        String labeledGroupId = labels(execution).get("wbdataGroupId");
        if (labeledGroupId != null && labeledGroupId.equals(String.valueOf(groupId))) {
            return true;
        }
        return execution.namespace() != null
                && execution.namespace().startsWith(offlineKestraProperties.buildDebugNamespacePrefix(groupId));
    }

    private boolean matchesRequestedBy(KestraExecutionSnapshot execution, Long requestedBy) {
        if (requestedBy == null) {
            return true;
        }
        Long executionRequestedBy = parseRequestedBy(execution);
        return requestedBy.equals(executionRequestedBy);
    }

    private Long parseRequestedBy(KestraExecutionSnapshot execution) {
        String labeledRequestedBy = labels(execution).get("wbdataRequestedBy");
        if (labeledRequestedBy != null && !labeledRequestedBy.isBlank()) {
            try {
                return Long.parseLong(labeledRequestedBy);
            } catch (NumberFormatException ignored) {
                // fall through to namespace parsing
            }
        }
        String namespace = execution.namespace();
        if (namespace == null) {
            return null;
        }
        int markerIndex = namespace.lastIndexOf("-u");
        if (markerIndex < 0 || markerIndex + 2 >= namespace.length()) {
            return null;
        }
        try {
            return Long.parseLong(namespace.substring(markerIndex + 2));
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    private String readCurrentBranch(Long groupId) {
        String branch = offlineRepoStatusService.getRepoStatus(groupId).branch();
        return branch == null || branch.isBlank() ? "main" : branch;
    }

    private boolean matchesBranch(KestraExecutionSnapshot execution, String branch) {
        String labeledBranch = labels(execution).get("wbdataBranch");
        return labeledBranch == null || labeledBranch.equals(branch);
    }

    private Map<String, String> labels(KestraExecutionSnapshot execution) {
        return execution.labels() == null ? Map.of() : execution.labels();
    }
}
