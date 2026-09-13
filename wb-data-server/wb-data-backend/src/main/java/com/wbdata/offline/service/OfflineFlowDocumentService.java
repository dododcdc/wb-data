package com.wbdata.offline.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wbdata.datasource.entity.DataSource;
import com.wbdata.datasource.service.DataSourceService;
import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.config.OfflineTransferProperties;
import com.wbdata.offline.dto.DebugDocumentExecutionRequest;
import com.wbdata.offline.dto.FlowParameterBindingItemResponse;
import com.wbdata.offline.dto.FlowParameterBindingRequest;
import com.wbdata.offline.dto.FlowParameterBindingResponse;
import com.wbdata.offline.dto.FlowParameterDefinitionSnapshot;
import com.wbdata.offline.dto.FlowParameterGroupBindingSnapshot;
import com.wbdata.offline.dto.FlowParameterSnapshot;
import com.wbdata.offline.dto.NodePosition;
import com.wbdata.offline.dto.OfflineFlowDocumentResponse;
import com.wbdata.offline.dto.OfflineFlowEdgeResponse;
import com.wbdata.offline.dto.OfflineFlowNodeResponse;
import com.wbdata.offline.dto.OfflineFlowSchedule;
import com.wbdata.offline.dto.OfflineFlowStageResponse;
import com.wbdata.offline.dto.SaveOfflineFlowDocumentRequest;
import com.wbdata.offline.dto.SaveOfflineFlowEdgeRequest;
import com.wbdata.offline.dto.SaveOfflineFlowNodeRequest;
import com.wbdata.offline.dto.SaveOfflineFlowStageRequest;
import com.wbdata.offline.transfer.dto.TransferConfig;
import com.wbdata.offline.transfer.service.TransferConfigFileService;
import com.wbdata.parameter.dto.ParameterDefinitionResponse;
import com.wbdata.parameter.dto.ParameterGroupResponse;
import com.wbdata.parameter.service.ParameterGroupService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

@Service
public class OfflineFlowDocumentService {

    public record CompiledFlowDraft(
            String content,
            Map<String, String> namespaceFileContents
    ) {
    }

    private record GraphDraft(
            List<OfflineFlowNode> nodes,
            List<OfflineFlowYamlSupport.FlowEdge> edges,
            Map<Long, DataSource> dataSourceMap,
            Map<String, String> scriptFileContents,
            Map<String, TransferConfig> transferConfigs,
            Map<String, String> namespaceFileContents
    ) {
    }

    private final OfflineProperties offlineProperties;
    private final OfflineFlowContentService offlineFlowContentService;
    private final DataSourceService dataSourceService;
    private final RepoLockManager repoLockManager;
    private final OfflineKestraFlowFileService kestraFlowFileService;
    private final TransferConfigFileService transferConfigFileService;
    private final ParameterGroupService parameterGroupService;
    private final FlowParameterSnapshotStore parameterSnapshotStore;
    private final ExecutionParameterSnapshotRegistry executionParameterSnapshotRegistry;
    private final FlowParameterCompiler parameterCompiler = new FlowParameterCompiler();
    private final OfflineFlowYamlSupport yamlSupport;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public OfflineFlowDocumentService(OfflineProperties offlineProperties,
                                      OfflineFlowContentService offlineFlowContentService,
                                      DataSourceService dataSourceService,
                                      RepoLockManager repoLockManager,
                                      OfflineKestraFlowFileService kestraFlowFileService,
                                      TransferConfigFileService transferConfigFileService,
                                      ParameterGroupService parameterGroupService,
                                      FlowParameterSnapshotStore parameterSnapshotStore,
                                      ExecutionParameterSnapshotRegistry executionParameterSnapshotRegistry,
                                      OfflineTransferProperties transferProperties) {
        this.offlineProperties = offlineProperties;
        this.offlineFlowContentService = offlineFlowContentService;
        this.dataSourceService = dataSourceService;
        this.repoLockManager = repoLockManager;
        this.kestraFlowFileService = kestraFlowFileService;
        this.transferConfigFileService = transferConfigFileService;
        this.parameterGroupService = parameterGroupService;
        this.parameterSnapshotStore = parameterSnapshotStore;
        this.executionParameterSnapshotRegistry = executionParameterSnapshotRegistry;
        this.yamlSupport = new OfflineFlowYamlSupport(transferProperties);
    }

    public OfflineFlowDocumentResponse getFlowDocument(Long groupId, String path) {
        return repoLockManager.withLock(groupId, () -> getFlowDocumentUnlocked(groupId, path));
    }

    private OfflineFlowDocumentResponse getFlowDocumentUnlocked(Long groupId, String path) {
        try {
            return readSnapshot(groupId, path).response();
        } catch (IOException ex) {
            throw new IllegalStateException("读取任务文档失败", ex);
        }
    }

    public OfflineFlowDocumentResponse saveFlowDocument(SaveOfflineFlowDocumentRequest request) {
        return repoLockManager.withLock(request.groupId(), () -> saveFlowDocumentUnlocked(request));
    }

    private OfflineFlowDocumentResponse saveFlowDocumentUnlocked(SaveOfflineFlowDocumentRequest request) {
        try {
            Path repoPath = offlineProperties.resolveRepoPath(request.groupId());
            Path flowFile = resolveRepoFile(repoPath, request.path());
            boolean isNewFile = !Files.exists(flowFile);
            String runtimeTimezone = resolveRuntimeTimezoneForSave(request, isNewFile);
            ParameterSnapshotUpdate parameterUpdate = prepareParameterSnapshotUpdate(
                    request.groupId(), request.parameterBinding(), request.parameterBindings(), runtimeTimezone);
            FlowParameterSnapshot effectiveParameterSnapshot = resolveEffectiveParameterSnapshot(
                    repoPath, request.path(), parameterUpdate);
            parameterUpdate = normalizeParameterSnapshotForSave(
                    parameterUpdate, effectiveParameterSnapshot, runtimeTimezone);
            effectiveParameterSnapshot = parameterUpdate.requested()
                    ? parameterUpdate.snapshot()
                    : effectiveParameterSnapshot;

            if (request.edges() != null) {
                // New graph-based save: compile DAG back to YAML
                String flowSource = isNewFile
                        ? yamlSupport.buildEmptyFlowYaml(extractFlowId(request.path()), "pg-" + request.groupId())
                        : offlineFlowContentService.getFlowContent(request.groupId(), request.path()).content();
                DocumentSnapshot current = null;
                if (!isNewFile && request.documentHash() != null) {
                    current = readSnapshot(request.groupId(), request.path());
                }
                if (current != null && request.documentHash() != null
                        && (!current.response().documentHash().equals(request.documentHash())
                        || current.response().documentUpdatedAt() != request.documentUpdatedAt())) {
                    throw new ResponseStatusException(HttpStatus.CONFLICT, "检测到文件已被修改，请先加载最新内容");
                }
                saveWithGraph(request, flowSource, effectiveParameterSnapshot, runtimeTimezone);
            } else {
                // Legacy stage-based save
                if (isNewFile) {
                    // For new flows, create a stub YAML with id, namespace, and empty tasks
                    String flowId = extractFlowId(request.path());
                    String namespace = "pg-" + request.groupId();
                    String stubYaml = yamlSupport.buildEmptyFlowYaml(flowId, namespace);
                    Files.createDirectories(flowFile.getParent());
                    Files.writeString(flowFile, stubYaml, StandardCharsets.UTF_8);
                }
                DocumentSnapshot current = readSnapshot(request.groupId(), request.path());
                if (!isNewFile && (request.documentHash() != null
                        && (!current.response().documentHash().equals(request.documentHash())
                        || current.response().documentUpdatedAt() != request.documentUpdatedAt()))) {
                    throw new ResponseStatusException(HttpStatus.CONFLICT, "检测到文件已被修改，请先加载最新内容");
                }
                saveWithStages(request, current);
                if (effectiveParameterSnapshot != null || parameterUpdate.requested()) {
                    recompileLegacyFlowWithParameters(request, effectiveParameterSnapshot);
                }
            }

            applyRuntimeTimezoneToFlowFile(repoPath, request.path(), runtimeTimezone);
            if (request.schedule() != null) {
                applyScheduleToFlowFile(repoPath, request.path(), new OfflineFlowSchedule(
                        request.schedule().cron(), runtimeTimezone, request.schedule().enabled()));
            }
            applyParameterSnapshotUpdate(repoPath, request.path(), parameterUpdate);
            kestraFlowFileService.syncFlowFile(repoPath, request.path());

            // Save layout.json if provided
            if (request.layout() != null && !request.layout().isEmpty()) {
                saveLayout(request.groupId(), request.path(), request.layout());
            }

            return readSnapshot(request.groupId(), request.path()).response();
        } catch (IOException ex) {
            throw new IllegalStateException("保存任务文档失败", ex);
        }
    }

    public List<String> resolveManagedFiles(Long groupId, String path) {
        return repoLockManager.withLock(groupId, () -> resolveManagedFilesUnlocked(groupId, path));
    }

    private List<String> resolveManagedFilesUnlocked(Long groupId, String path) {
        try {
            DocumentSnapshot snapshot = readSnapshot(groupId, path);
            Path repoPath = offlineProperties.resolveRepoPath(groupId);
            LinkedHashSet<String> files = new LinkedHashSet<>();
            files.add(path);

            Path layoutFile = resolveLayoutFile(repoPath, path);
            if (Files.exists(layoutFile)) {
                files.add(repoPath.relativize(layoutFile).toString().replace('\\', '/'));
            }

            Path kestraFlowFile = kestraFlowFileService.resolveFlowFile(repoPath, path);
            if (Files.exists(kestraFlowFile)) {
                files.add(repoPath.relativize(kestraFlowFile).toString().replace('\\', '/'));
            }

            for (Path taskFile : snapshot.managedNodeFiles()) {
                files.add(repoPath.relativize(taskFile).toString().replace('\\', '/'));
            }
            return List.copyOf(files);
        } catch (IOException ex) {
            throw new IllegalStateException("解析任务关联文件失败", ex);
        }
    }

    public CompiledFlowDraft compileFlowDraft(DebugDocumentExecutionRequest request) {
        return repoLockManager.withLock(request.groupId(), () -> compileFlowDraftUnlocked(request));
    }

    private CompiledFlowDraft compileFlowDraftUnlocked(DebugDocumentExecutionRequest request) {
        try {
            DocumentSnapshot current = readSnapshot(request.groupId(), request.flowPath());
            if (request.documentHash() != null
                    && (!current.response().documentHash().equals(request.documentHash())
                    || current.response().documentUpdatedAt() != request.documentUpdatedAt())) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "检测到文件已被修改，请先加载最新内容");
            }

            GraphDraft draft = prepareGraphDraft(
                    request.groupId(),
                    request.flowPath(),
                    request.stages(),
                    request.edges()
            );
            var flowContent = offlineFlowContentService.getFlowContent(request.groupId(), request.flowPath());
            Path repoPath = offlineProperties.resolveRepoPath(request.groupId());
            FlowParameterSnapshot parameterSnapshot = parameterSnapshotStore.read(repoPath, request.flowPath())
                    .map(FlowParameterSnapshotStore.SnapshotFile::snapshot)
                    .orElse(null);
            FlowParameterCompiler.Compilation parameterCompilation = parameterCompiler.compile(
                    parameterSnapshot,
                    draft.nodes(),
                    draft.scriptFileContents()
            );
            String compiledYaml = yamlSupport.compileGraph(
                    flowContent.content(),
                    draft.nodes(),
                    draft.edges(),
                    draft.dataSourceMap(),
                    parameterCompilation
            );
            compiledYaml = applyParameterSnapshotId(request.groupId(), compiledYaml, parameterSnapshot);
            return new CompiledFlowDraft(compiledYaml, draft.namespaceFileContents());
        } catch (IOException ex) {
            throw new IllegalStateException("编译任务文档失败", ex);
        }
    }

    private String extractFlowId(String path) {
        // path format: _flows/{folder}/{name}/flow.yaml
        String[] parts = path.split("/");
        if (parts.length >= 2) {
            return parts[parts.length - 2];
        }
        return "flow";
    }

    private void saveWithGraph(SaveOfflineFlowDocumentRequest request,
                               String flowSource,
                               FlowParameterSnapshot parameterSnapshot,
                               String runtimeTimezone) throws IOException {
        Path repoPath = offlineProperties.resolveRepoPath(request.groupId());
        GraphDraft graphDraft = prepareGraphDraft(
                request.groupId(),
                request.path(),
                request.stages(),
                request.edges()
        );

        // SQL / HiveSQL 节点必须绑定数据源
        for (var node : graphDraft.nodes()) {
            if (("SQL".equalsIgnoreCase(node.kind()) || "HIVE_SQL".equalsIgnoreCase(node.kind()))
                    && node.dataSourceId() == null) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "节点 " + node.taskId() + " 是 SQL 类型，保存前必须绑定数据源");
            }
        }

        FlowParameterCompiler.Compilation parameterCompilation = parameterCompiler.compile(
                parameterSnapshot,
                graphDraft.nodes(),
                graphDraft.scriptFileContents()
        );
        String compiledYaml = yamlSupport.compileGraph(
                flowSource,
                graphDraft.nodes(),
                graphDraft.edges(),
                graphDraft.dataSourceMap(),
                parameterCompilation
        );
        compiledYaml = applyParameterSnapshotId(request.groupId(), compiledYaml, parameterSnapshot);
        writeGraphFiles(repoPath, request.groupId(), request.path(), graphDraft);

        Path flowFile = resolveRepoFile(repoPath, request.path());
        Files.createDirectories(flowFile.getParent());
        Files.writeString(flowFile, compiledYaml, StandardCharsets.UTF_8);
    }

    private void applyScheduleToFlowFile(Path repoPath, String flowPath, OfflineFlowSchedule schedule) throws IOException {
        Path flowFile = resolveRepoFile(repoPath, flowPath);
        String current = Files.readString(flowFile, StandardCharsets.UTF_8);
        Files.writeString(flowFile, yamlSupport.applySchedule(current, schedule), StandardCharsets.UTF_8);
    }

    private void applyRuntimeTimezoneToFlowFile(Path repoPath,
                                                String flowPath,
                                                String runtimeTimezone) throws IOException {
        Path flowFile = resolveRepoFile(repoPath, flowPath);
        String current = Files.readString(flowFile, StandardCharsets.UTF_8);
        Files.writeString(flowFile,
                yamlSupport.applyRuntimeTimezoneLabel(current, runtimeTimezone),
                StandardCharsets.UTF_8);
    }

    private void writeGraphFiles(Path repoPath, Long groupId, String flowPath, GraphDraft graphDraft) throws IOException {
        for (Map.Entry<String, String> entry : graphDraft.scriptFileContents().entrySet()) {
            Path scriptFile = resolveRepoFile(repoPath, entry.getKey());
            Files.createDirectories(scriptFile.getParent());
            Files.writeString(scriptFile, entry.getValue(), StandardCharsets.UTF_8);
        }
        for (Map.Entry<String, TransferConfig> entry : graphDraft.transferConfigs().entrySet()) {
            transferConfigFileService.write(repoPath, groupId, flowPath, entry.getKey(), entry.getValue());
        }
        List<String> activeTransferPaths = graphDraft.nodes().stream()
                .filter(node -> "TRANSFER".equalsIgnoreCase(node.kind()))
                .map(OfflineFlowNode::transferConfigPath)
                .toList();
        transferConfigFileService.deleteStaleForFlow(repoPath, flowPath, activeTransferPaths);
    }

    private GraphDraft prepareGraphDraft(Long groupId,
                                         String flowPath,
                                         List<SaveOfflineFlowStageRequest> stages,
                                         List<SaveOfflineFlowEdgeRequest> requestEdges) throws IOException {
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        List<OfflineFlowNode> nodes = new ArrayList<>();
        Set<Long> dataSourceIds = new LinkedHashSet<>();
        Map<String, String> namespaceFileContents = new LinkedHashMap<>();
        Map<String, String> scriptFileContents = new LinkedHashMap<>();
        Map<String, TransferConfig> transferConfigs = new LinkedHashMap<>();

        for (SaveOfflineFlowStageRequest stage : stages) {
            for (SaveOfflineFlowNodeRequest nodeReq : stage.nodes()) {
                boolean transferNode = "TRANSFER".equalsIgnoreCase(nodeReq.kind());
                String transferConfigPath = transferNode
                        ? transferConfigFileService.buildPath(flowPath, nodeReq.taskId())
                        : null;
                nodes.add(new OfflineFlowNode(
                        nodeReq.taskId(),
                        nodeReq.kind(),
                        nodeReq.scriptPath(),
                        nodeReq.dataSourceId(),
                        nodeReq.dataSourceType(),
                        transferConfigPath
                ));
                if (nodeReq.dataSourceId() != null) {
                    dataSourceIds.add(nodeReq.dataSourceId());
                }

                if (transferNode) {
                    transferConfigs.put(nodeReq.taskId(), nodeReq.transfer());
                    namespaceFileContents.put(transferConfigPath,
                            transferConfigFileService.serialize(groupId, flowPath, nodeReq.taskId(), nodeReq.transfer()));
                } else {
                    scriptFileContents.put(nodeReq.scriptPath(), nodeReq.scriptContent());
                    namespaceFileContents.put(nodeReq.scriptPath(), nodeReq.scriptContent());
                }
            }
        }

        Map<Long, DataSource> dataSourceMap = new LinkedHashMap<>();
        for (Long dsId : dataSourceIds) {
            DataSource ds = dataSourceService.getById(dsId);
            if (ds != null) {
                dataSourceMap.put(dsId, ds);
            }
        }

        List<OfflineFlowYamlSupport.FlowEdge> edges = requestEdges.stream()
                .map(e -> new OfflineFlowYamlSupport.FlowEdge(e.source(), e.target()))
                .toList();

        return new GraphDraft(nodes, edges, dataSourceMap, scriptFileContents, transferConfigs, namespaceFileContents);
    }

    private void saveWithStages(SaveOfflineFlowDocumentRequest request, DocumentSnapshot current) throws IOException {
        validateStructure(current, request);

        Map<String, SaveOfflineFlowNodeRequest> requestedNodes = flattenRequestedNodes(request.stages());
        for (Map.Entry<String, Path> entry : current.taskFiles().entrySet()) {
            SaveOfflineFlowNodeRequest node = requestedNodes.get(entry.getKey());
            if (node == null) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "当前版本仅支持编辑已有节点内容");
            }
            Files.writeString(entry.getValue(), node.scriptContent(), StandardCharsets.UTF_8);
        }
    }

    private void recompileLegacyFlowWithParameters(SaveOfflineFlowDocumentRequest request,
                                                   FlowParameterSnapshot parameterSnapshot) throws IOException {
        String flowSource = offlineFlowContentService.getFlowContent(request.groupId(), request.path()).content();
        OfflineFlowYamlSupport.FlowGraph graph = yamlSupport.parseGraph(flowSource);
        List<SaveOfflineFlowEdgeRequest> edges = graph.edges().stream()
                .map(edge -> new SaveOfflineFlowEdgeRequest(edge.source(), edge.target()))
                .toList();
        GraphDraft draft = prepareGraphDraft(
                request.groupId(),
                request.path(),
                request.stages(),
                edges
        );
        FlowParameterCompiler.Compilation parameterCompilation = parameterCompiler.compile(
                parameterSnapshot,
                draft.nodes(),
                draft.scriptFileContents()
        );
        String compiledYaml = yamlSupport.compileGraph(
                flowSource,
                draft.nodes(),
                draft.edges(),
                draft.dataSourceMap(),
                parameterCompilation
        );
        compiledYaml = applyParameterSnapshotId(request.groupId(), compiledYaml, parameterSnapshot);
        Files.writeString(resolveRepoFile(
                offlineProperties.resolveRepoPath(request.groupId()), request.path()), compiledYaml, StandardCharsets.UTF_8);
    }

    private String applyParameterSnapshotId(Long groupId,
                                            String flowSource,
                                            FlowParameterSnapshot parameterSnapshot) {
        String snapshotId = parameterSnapshot == null
                ? null
                : executionParameterSnapshotRegistry.register(groupId, parameterSnapshot);
        return yamlSupport.applyParameterSnapshotId(flowSource, snapshotId);
    }

    private OfflineFlowNodeResponse findNodeInResponse(OfflineFlowDocumentResponse response, String taskId) {
        for (OfflineFlowStageResponse stage : response.stages()) {
            for (OfflineFlowNodeResponse node : stage.nodes()) {
                if (node.taskId().equals(taskId)) return node;
            }
        }
        return null;
    }

    private DocumentSnapshot readSnapshot(Long groupId, String path) throws IOException {
        var flow = offlineFlowContentService.getFlowContent(groupId, path);
        Path repoPath = offlineProperties.resolveRepoPath(groupId);

        // Parse both stage-based and graph-based representations
        OfflineFlowYamlSupport.FlowDocument document = yamlSupport.parseDocument(flow.content());
        OfflineFlowYamlSupport.FlowGraph graph = yamlSupport.parseGraph(flow.content());
        OfflineFlowYamlSupport.ScheduleData scheduleData = yamlSupport.readSchedule(flow.content());
        OfflineFlowSchedule schedule = scheduleData == null
                ? null
                : new OfflineFlowSchedule(
                        scheduleData.cron(),
                        scheduleData.timezone(),
                        scheduleData.enabled()
                );

        List<OfflineFlowStageResponse> stages = new ArrayList<>();
        Map<String, Path> taskFiles = new LinkedHashMap<>();
        Set<Path> managedNodeFiles = new LinkedHashSet<>();
        Set<String> seenTaskIds = new LinkedHashSet<>();
        List<String> stageKeys = new ArrayList<>();
        List<String> taskOrder = new ArrayList<>();
        long updatedAt = flow.fileUpdatedAt();
        StringBuilder signature = new StringBuilder()
                .append(path)
                .append('\n')
                .append(flow.content());

        Optional<FlowParameterSnapshotStore.SnapshotFile> parameterFile = parameterSnapshotStore.read(repoPath, path);
        FlowParameterBindingResponse parameterBinding = null;
        if (parameterFile.isPresent()) {
            FlowParameterSnapshotStore.SnapshotFile file = parameterFile.get();
            updatedAt = Math.max(updatedAt, file.updatedAt());
            signature.append('\n')
                    .append(file.path().getFileName())
                    .append('\n')
                    .append(file.content());
            managedNodeFiles.add(file.path());
            parameterBinding = resolveParameterBinding(groupId, file.snapshot());
        }

        for (OfflineFlowYamlSupport.FlowStage stage : document.stages()) {
            stageKeys.add(stage.stageId());
            List<OfflineFlowNodeResponse> nodes = new ArrayList<>();
            for (OfflineFlowNode node : stage.nodes()) {
                if (!seenTaskIds.add(node.taskId())) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Flow YAML 中存在重复 taskId");
                }
                taskOrder.add(node.taskId());
                if ("TRANSFER".equalsIgnoreCase(node.kind())) {
                    TransferConfig transfer = transferConfigFileService.read(repoPath, node.transferConfigPath());
                    Path transferFile = resolveRepoFile(repoPath, node.transferConfigPath());
                    if (Files.isRegularFile(transferFile)) {
                        updatedAt = Math.max(updatedAt, Files.getLastModifiedTime(transferFile).toMillis());
                        String transferContent = Files.readString(transferFile, StandardCharsets.UTF_8);
                        signature.append('\n')
                                .append(node.taskId())
                                .append('\n')
                                .append(node.transferConfigPath())
                                .append('\n')
                                .append(transferContent);
                        managedNodeFiles.add(transferFile);
                    }
                    nodes.add(new OfflineFlowNodeResponse(
                            node.taskId(),
                            node.kind(),
                            null,
                            null,
                            null,
                            null,
                            transfer
                    ));
                } else {
                    Path scriptFile = resolveRepoFile(repoPath, node.scriptPath());
                    if (!Files.isRegularFile(scriptFile)) {
                        throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                                "脚本文件不存在: " + node.scriptPath());
                    }
                    String scriptContent = Files.readString(scriptFile, StandardCharsets.UTF_8);
                    updatedAt = Math.max(updatedAt, Files.getLastModifiedTime(scriptFile).toMillis());
                    signature.append('\n')
                            .append(node.taskId())
                            .append('\n')
                            .append(node.scriptPath())
                            .append('\n')
                            .append(scriptContent);
                    taskFiles.put(node.taskId(), scriptFile);
                    managedNodeFiles.add(scriptFile);
                    nodes.add(new OfflineFlowNodeResponse(
                            node.taskId(),
                            node.kind(),
                            node.scriptPath(),
                            scriptContent,
                            node.dataSourceId(),
                            node.dataSourceType()
                    ));
                }
            }
            stages.add(new OfflineFlowStageResponse(stage.stageId(), stage.parallel(), nodes));
        }

        // Build edges from graph
        List<OfflineFlowEdgeResponse> edges = graph.edges().stream()
                .map(e -> new OfflineFlowEdgeResponse(e.source(), e.target()))
                .toList();

        // Read layout.json if it exists
        Map<String, NodePosition> layout = readLayout(groupId, path);

        String runtimeTimezone = yamlSupport.readLabel(flow.content(), "wbdataRuntimeTimezone");
        if ((runtimeTimezone == null || runtimeTimezone.isBlank())
                && schedule != null && schedule.timezone() != null && !schedule.timezone().isBlank()) {
            runtimeTimezone = schedule.timezone();
        }
        if ((runtimeTimezone == null || runtimeTimezone.isBlank()) && parameterFile.isPresent()) {
            runtimeTimezone = parameterFile.get().snapshot().runtimeTimezone();
        }
        runtimeTimezone = runtimeTimezone == null || runtimeTimezone.isBlank()
                ? null
                : runtimeTimezone.trim();

        return new DocumentSnapshot(
                new OfflineFlowDocumentResponse(
                        groupId,
                        path,
                        document.flowId(),
                        document.namespace(),
                        yamlSupport.sha256Hex(signature.toString()),
                        updatedAt,
                        stages,
                        edges,
                        layout,
                        schedule,
                        parameterBinding,
                        runtimeTimezone
                ),
                taskFiles,
                managedNodeFiles,
                stageKeys,
                taskOrder
        );
    }

    private Map<String, NodePosition> readLayout(Long groupId, String path) {
        try {
            Path repoPath = offlineProperties.resolveRepoPath(groupId);
            Path layoutFile = resolveLayoutFile(repoPath, path);
            if (!Files.isRegularFile(layoutFile)) {
                return Collections.emptyMap();
            }
            String json = Files.readString(layoutFile, StandardCharsets.UTF_8);
            return objectMapper.readValue(json, new TypeReference<>() {});
        } catch (IOException ex) {
            return Collections.emptyMap();
        }
    }

    private void saveLayout(Long groupId, String path, Map<String, NodePosition> layout) throws IOException {
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        Path layoutFile = resolveLayoutFile(repoPath, path);
        Files.createDirectories(layoutFile.getParent());
        String json = objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(layout);
        Files.writeString(layoutFile, json, StandardCharsets.UTF_8);
    }

    private Path resolveLayoutFile(Path repoPath, String flowPath) {
        // flow.yaml → .layout.json in the same directory
        Path flowFile = Path.of(flowPath).normalize();
        Path parent = flowFile.getParent();
        String layoutName = ".layout.json";
        Path layoutRelative = parent != null ? parent.resolve(layoutName) : Path.of(layoutName);
        Path resolved = repoPath.resolve(layoutRelative).normalize();
        if (!resolved.startsWith(repoPath)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "布局文件路径不合法");
        }
        return resolved;
    }

    private String requireRuntimeTimezone(String runtimeTimezone) {
        if (runtimeTimezone == null || runtimeTimezone.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "任务运行时区不能为空");
        }
        String normalized = runtimeTimezone.trim();
        try {
            ZoneId.of(normalized);
        } catch (RuntimeException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "任务运行时区不合法");
        }
        return normalized;
    }

    private String resolveRuntimeTimezoneForSave(SaveOfflineFlowDocumentRequest request,
                                                 boolean isNewFile) throws IOException {
        String requestedTimezone = requireRuntimeTimezone(request.runtimeTimezone());
        if (isNewFile) {
            return requestedTimezone;
        }

        String existingTimezone = readSnapshot(request.groupId(), request.path()).response().runtimeTimezone();
        if (existingTimezone == null || existingTimezone.isBlank()) {
            return requestedTimezone;
        }
        existingTimezone = requireRuntimeTimezone(existingTimezone);
        if (!existingTimezone.equals(requestedTimezone)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "任务运行时区创建后不能修改");
        }
        return existingTimezone;
    }

    private ParameterSnapshotUpdate prepareParameterSnapshotUpdate(Long groupId,
                                                                   FlowParameterBindingRequest singleBinding,
                                                                   List<FlowParameterBindingRequest> multipleBindings,
                                                                   String runtimeTimezone) {
        List<FlowParameterBindingRequest> bindings;
        if (multipleBindings != null) {
            bindings = multipleBindings;
        } else if (singleBinding != null) {
            bindings = List.of(singleBinding);
        } else {
            return new ParameterSnapshotUpdate(false, null);
        }

        if (bindings.isEmpty() || (bindings.size() == 1 && bindings.get(0).parameterGroupId() == null)) {
            FlowParameterBindingRequest first = bindings.isEmpty() ? null : bindings.get(0);
            if (first != null && first.expectedVersion() != null) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "解除参数组绑定时不能提供 expectedVersion");
            }
            return new ParameterSnapshotUpdate(true, null);
        }

        List<FlowParameterGroupBindingSnapshot> groupSnapshots = new ArrayList<>();
        Map<String, FlowParameterDefinitionSnapshot> mergedDefinitions = new LinkedHashMap<>();

        for (FlowParameterBindingRequest binding : bindings) {
            if (binding.parameterGroupId() == null) {
                continue;
            }
            if (binding.expectedVersion() == null) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "绑定参数组时必须提供 expectedVersion");
            }

            ParameterGroupResponse group = parameterGroupService.get(groupId, binding.parameterGroupId());
            if ("ARCHIVED".equals(group.status())) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "已归档的参数组不能绑定到任务");
            }
            if (!group.version().equals(binding.expectedVersion())) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "参数组版本已变化，请刷新后重试");
            }

            List<FlowParameterDefinitionSnapshot> groupDefs = group.definitions().stream()
                    .map(this::toSnapshotDefinition)
                    .toList();

            groupSnapshots.add(new FlowParameterGroupBindingSnapshot(
                    group.code(),
                    group.version(),
                    groupDefs
            ));

            for (FlowParameterDefinitionSnapshot def : groupDefs) {
                mergedDefinitions.putIfAbsent(def.key(), def);
            }
        }

        if (groupSnapshots.isEmpty()) {
            return new ParameterSnapshotUpdate(true, null);
        }

        FlowParameterGroupBindingSnapshot firstGroup = groupSnapshots.get(0);
        FlowParameterSnapshot snapshot = new FlowParameterSnapshot(
                2,
                runtimeTimezone,
                firstGroup.groupCode(),
                firstGroup.groupVersion(),
                new ArrayList<>(mergedDefinitions.values()),
                groupSnapshots
        );
        return new ParameterSnapshotUpdate(true, snapshot);
    }

    private ParameterSnapshotUpdate normalizeParameterSnapshotForSave(ParameterSnapshotUpdate requestedUpdate,
                                                                       FlowParameterSnapshot effectiveSnapshot,
                                                                       String runtimeTimezone) {
        if (effectiveSnapshot == null) {
            return requestedUpdate;
        }
        if (effectiveSnapshot.schemaVersion() == 2
                && runtimeTimezone.equals(effectiveSnapshot.runtimeTimezone())) {
            return requestedUpdate;
        }
        return new ParameterSnapshotUpdate(true, new FlowParameterSnapshot(
                2,
                runtimeTimezone,
                effectiveSnapshot.groupCode(),
                effectiveSnapshot.groupVersion(),
                effectiveSnapshot.definitions(),
                effectiveSnapshot.groups()
        ));
    }

    private void applyParameterSnapshotUpdate(Path repoPath,
                                              String flowPath,
                                              ParameterSnapshotUpdate update) throws IOException {
        if (!update.requested()) {
            return;
        }
        if (update.snapshot() == null) {
            parameterSnapshotStore.delete(repoPath, flowPath);
        } else {
            parameterSnapshotStore.write(repoPath, flowPath, update.snapshot());
        }
    }

    private FlowParameterSnapshot resolveEffectiveParameterSnapshot(Path repoPath,
                                                                    String flowPath,
                                                                    ParameterSnapshotUpdate update) throws IOException {
        if (update.requested()) {
            return update.snapshot();
        }
        return parameterSnapshotStore.read(repoPath, flowPath)
                .map(FlowParameterSnapshotStore.SnapshotFile::snapshot)
                .orElse(null);
    }

    private FlowParameterBindingResponse resolveParameterBinding(Long groupId, FlowParameterSnapshot snapshot) {
        if (snapshot == null) {
            return null;
        }

        if (snapshot.groups() != null && !snapshot.groups().isEmpty()) {
            List<FlowParameterBindingItemResponse> itemResponses = new ArrayList<>();
            Map<String, FlowParameterDefinitionSnapshot> mergedDefs = new LinkedHashMap<>();
            boolean anyOutdated = false;
            boolean anyArchived = false;
            boolean anyMissing = false;

            for (FlowParameterGroupBindingSnapshot groupSnapshot : snapshot.groups()) {
                Optional<ParameterGroupResponse> current = parameterGroupService.findByCode(groupId, groupSnapshot.groupCode());
                if (current.isEmpty()) {
                    anyMissing = true;
                    itemResponses.add(new FlowParameterBindingItemResponse(
                            null,
                            groupSnapshot.groupCode(),
                            null,
                            groupSnapshot.groupVersion(),
                            null,
                            "MISSING",
                            groupSnapshot.definitions()
                    ));
                } else {
                    ParameterGroupResponse group = current.get();
                    String status;
                    if ("ARCHIVED".equals(group.status())) {
                        status = "ARCHIVED";
                        anyArchived = true;
                    } else if (group.version().equals(groupSnapshot.groupVersion())) {
                        status = "CURRENT";
                    } else {
                        status = "OUTDATED";
                        anyOutdated = true;
                    }
                    itemResponses.add(new FlowParameterBindingItemResponse(
                            group.id(),
                            groupSnapshot.groupCode(),
                            group.name(),
                            groupSnapshot.groupVersion(),
                            group.version(),
                            status,
                            groupSnapshot.definitions()
                    ));
                }

                if (groupSnapshot.definitions() != null) {
                    for (FlowParameterDefinitionSnapshot def : groupSnapshot.definitions()) {
                        mergedDefs.putIfAbsent(def.key(), def);
                    }
                }
            }

            FlowParameterBindingItemResponse firstItem = itemResponses.get(0);
            String compositeStatus = anyMissing ? "MISSING" : anyArchived ? "ARCHIVED" : anyOutdated ? "OUTDATED" : "CURRENT";

            return new FlowParameterBindingResponse(
                    firstItem.parameterGroupId(),
                    firstItem.code(),
                    firstItem.name(),
                    firstItem.boundVersion(),
                    firstItem.currentVersion(),
                    compositeStatus,
                    new ArrayList<>(mergedDefs.values()),
                    itemResponses
            );
        }

        Optional<ParameterGroupResponse> current = parameterGroupService.findByCode(groupId, snapshot.groupCode());
        if (current.isEmpty()) {
            FlowParameterBindingItemResponse item = new FlowParameterBindingItemResponse(
                    null,
                    snapshot.groupCode(),
                    null,
                    snapshot.groupVersion(),
                    null,
                    "MISSING",
                    snapshot.definitions()
            );
            return new FlowParameterBindingResponse(
                    null,
                    snapshot.groupCode(),
                    null,
                    snapshot.groupVersion(),
                    null,
                    "MISSING",
                    snapshot.definitions(),
                    List.of(item)
            );
        }

        ParameterGroupResponse group = current.get();
        String status;
        if ("ARCHIVED".equals(group.status())) {
            status = "ARCHIVED";
        } else if (group.version().equals(snapshot.groupVersion())) {
            status = "CURRENT";
        } else {
            status = "OUTDATED";
        }
        FlowParameterBindingItemResponse item = new FlowParameterBindingItemResponse(
                group.id(),
                snapshot.groupCode(),
                group.name(),
                snapshot.groupVersion(),
                group.version(),
                status,
                snapshot.definitions()
        );
        return new FlowParameterBindingResponse(
                group.id(),
                snapshot.groupCode(),
                group.name(),
                snapshot.groupVersion(),
                group.version(),
                status,
                snapshot.definitions(),
                List.of(item)
        );
    }

    private FlowParameterDefinitionSnapshot toSnapshotDefinition(ParameterDefinitionResponse definition) {
        return new FlowParameterDefinitionSnapshot(
                definition.key(),
                definition.valueSource(),
                definition.constantValue(),
                definition.format(),
                definition.offsetDays(),
                definition.description(),
                definition.sortOrder(),
                definition.timeBasis()
        );
    }

    private void validateStructure(DocumentSnapshot current, SaveOfflineFlowDocumentRequest request) {
        List<String> requestedStages = request.stages().stream()
                .map(SaveOfflineFlowStageRequest::stageId)
                .toList();
        if (!current.stageOrder().equals(requestedStages)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "当前版本仅支持编辑已有节点内容");
        }

        List<String> requestedTaskOrder = request.stages().stream()
                .flatMap(stage -> stage.nodes().stream())
                .map(SaveOfflineFlowNodeRequest::taskId)
                .toList();
        if (!current.taskOrder().equals(requestedTaskOrder)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "当前版本仅支持编辑已有节点内容");
        }
    }

    private Map<String, SaveOfflineFlowNodeRequest> flattenRequestedNodes(List<SaveOfflineFlowStageRequest> stages) {
        Map<String, SaveOfflineFlowNodeRequest> nodes = new LinkedHashMap<>();
        for (SaveOfflineFlowStageRequest stage : stages) {
            for (SaveOfflineFlowNodeRequest node : stage.nodes()) {
                nodes.put(node.taskId(), node);
            }
        }
        return nodes;
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

    private record DocumentSnapshot(
            OfflineFlowDocumentResponse response,
            Map<String, Path> taskFiles,
            Set<Path> managedNodeFiles,
            List<String> stageOrder,
            List<String> taskOrder
    ) {
    }

    private record ParameterSnapshotUpdate(boolean requested, FlowParameterSnapshot snapshot) {
    }
}
