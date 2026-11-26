package com.wbdata.offline.service;

import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.dto.OfflineFlowDocumentResponse;
import com.wbdata.offline.dto.SaveOfflineFlowDocumentRequest;
import com.wbdata.offline.dto.SaveOfflineFlowEdgeRequest;
import com.wbdata.offline.dto.SaveOfflineFlowNodeRequest;
import com.wbdata.offline.dto.SaveOfflineFlowStageRequest;
import com.wbdata.offline.execution.dto.DebugDocumentExecutionRequest;
import com.wbdata.offline.parameter.dto.FlowParameterSnapshot;
import com.wbdata.offline.parameter.service.ExecutionParameterSnapshotRegistry;
import com.wbdata.offline.parameter.service.FlowParameterBindingAssembler;
import com.wbdata.offline.parameter.service.FlowParameterBindingAssembler.ParameterSnapshotUpdate;
import com.wbdata.offline.parameter.service.FlowParameterSnapshotStore;
import com.wbdata.offline.schedule.dto.OfflineFlowSchedule;
import com.wbdata.offline.service.FlowGraphDraftBuilder.GraphDraft;
import com.wbdata.offline.service.OfflineFlowDocumentStore.DocumentSnapshot;
import org.springframework.http.HttpStatus;
import org.springframework.lang.Nullable;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 离线任务文档保存与草稿编译（调用方必须已持有仓库锁）。
 */
final class OfflineFlowDocumentWriter {

    private final OfflineProperties offlineProperties;
    private final OfflineFlowContentService offlineFlowContentService;
    private final OfflineKestraFlowFileService kestraFlowFileService;
    private final FlowParameterSnapshotStore parameterSnapshotStore;
    private final FlowParameterBindingAssembler parameterBindingAssembler;
    private final FlowGraphDraftBuilder graphDraftBuilder;
    private final ExecutionParameterSnapshotRegistry executionParameterSnapshotRegistry;
    private final OfflineHiveConfigStore hiveConfigStore;
    private final OfflineFlowYamlSupport yamlSupport;
    private final FlowParameterCompiler parameterCompiler;
    private final OfflineFlowDocumentStore store;
    @Nullable
    private final OfflineFlowIndexService offlineFlowIndexService;

    OfflineFlowDocumentWriter(OfflineProperties offlineProperties,
                              OfflineFlowContentService offlineFlowContentService,
                              OfflineKestraFlowFileService kestraFlowFileService,
                              FlowParameterSnapshotStore parameterSnapshotStore,
                              FlowParameterBindingAssembler parameterBindingAssembler,
                              FlowGraphDraftBuilder graphDraftBuilder,
                              ExecutionParameterSnapshotRegistry executionParameterSnapshotRegistry,
                              OfflineHiveConfigStore hiveConfigStore,
                              OfflineFlowYamlSupport yamlSupport,
                              FlowParameterCompiler parameterCompiler,
                              OfflineFlowDocumentStore store,
                              @Nullable OfflineFlowIndexService offlineFlowIndexService) {
        this.offlineProperties = offlineProperties;
        this.offlineFlowContentService = offlineFlowContentService;
        this.kestraFlowFileService = kestraFlowFileService;
        this.parameterSnapshotStore = parameterSnapshotStore;
        this.parameterBindingAssembler = parameterBindingAssembler;
        this.graphDraftBuilder = graphDraftBuilder;
        this.executionParameterSnapshotRegistry = executionParameterSnapshotRegistry;
        this.hiveConfigStore = hiveConfigStore;
        this.yamlSupport = yamlSupport;
        this.parameterCompiler = parameterCompiler;
        this.store = store;
        this.offlineFlowIndexService = offlineFlowIndexService;
    }

    OfflineFlowDocumentResponse saveUnlocked(SaveOfflineFlowDocumentRequest request) {
        try {
            Path repoPath = offlineProperties.resolveRepoPath(request.groupId());
            Path flowFile = store.resolveRepoFile(repoPath, request.path());
            boolean isNewFile = !Files.exists(flowFile);
            String runtimeTimezone = resolveRuntimeTimezoneForSave(request, isNewFile);
            String flowSource = isNewFile
                    ? yamlSupport.buildEmptyFlowYaml(extractFlowId(request.path()), "pg-" + request.groupId())
                    : offlineFlowContentService.getFlowContent(request.groupId(), request.path()).content();
            // Reject malformed draft schedules before writing scripts, sidecars or a new stub.
            yamlSupport.applySchedule(flowSource, request.schedule());
            ParameterSnapshotUpdate parameterUpdate = parameterBindingAssembler.prepareParameterSnapshotUpdate(
                    request.groupId(), request.parameterBinding(), request.parameterBindings(), runtimeTimezone);
            FlowParameterSnapshot effectiveParameterSnapshot = parameterBindingAssembler.resolveEffectiveParameterSnapshot(
                    repoPath, request.path(), parameterUpdate);
            parameterUpdate = parameterBindingAssembler.normalizeParameterSnapshotForSave(
                    parameterUpdate, effectiveParameterSnapshot, runtimeTimezone);
            effectiveParameterSnapshot = parameterUpdate.requested()
                    ? parameterUpdate.snapshot()
                    : effectiveParameterSnapshot;

            if (request.edges() != null) {
                if (!isNewFile && request.documentHash() != null) {
                    DocumentSnapshot current = store.readSnapshot(request.groupId(), request.path());
                    store.assertOptimisticLock(current, request.documentHash(), request.documentUpdatedAt());
                }
                saveWithGraph(request, flowSource, effectiveParameterSnapshot);
            } else {
                if (isNewFile) {
                    String flowId = extractFlowId(request.path());
                    String namespace = "pg-" + request.groupId();
                    String stubYaml = yamlSupport.buildEmptyFlowYaml(flowId, namespace);
                    Files.createDirectories(flowFile.getParent());
                    Files.writeString(flowFile, stubYaml, StandardCharsets.UTF_8);
                }
                DocumentSnapshot current = store.readSnapshot(request.groupId(), request.path());
                if (!isNewFile) {
                    store.assertOptimisticLock(current, request.documentHash(), request.documentUpdatedAt());
                }
                saveWithStages(request, current);
                LegacyHiveConfResolution hiveConfResolution = syncLegacyHiveConfAndDetectChange(repoPath, request);
                if (effectiveParameterSnapshot != null || parameterUpdate.requested() || hiveConfResolution.changed()) {
                    recompileLegacyFlowWithParameters(
                            request, hiveConfResolution.mergedStages(), effectiveParameterSnapshot);
                }
            }

            applyRuntimeTimezoneToFlowFile(repoPath, request.path(), runtimeTimezone);
            if (request.schedule() != null) {
                boolean retryEnabled = request.schedule().retryEnabled();
                applyScheduleToFlowFile(repoPath, request.path(), new OfflineFlowSchedule(
                        request.schedule().cron(),
                        runtimeTimezone,
                        request.schedule().enabled(),
                        request.schedule().period(),
                        retryEnabled,
                        retryEnabled ? request.schedule().retryCount() : null,
                        retryEnabled ? request.schedule().retryIntervalMinutes() : null));
            }
            if (request.dependencyConfig() != null) {
                var settings = request.dependencyConfig();
                String content = Files.readString(flowFile, StandardCharsets.UTF_8);
                Files.writeString(flowFile, yamlSupport.applyDependencyConfig(content, settings.dependencies(),
                        settings.failurePolicy(), settings.crossGroupDependency()), StandardCharsets.UTF_8);
            }
            parameterBindingAssembler.applyParameterSnapshotUpdate(repoPath, request.path(), parameterUpdate);
            kestraFlowFileService.syncFlowFile(repoPath, request.path());

            if (request.layout() != null && !request.layout().isEmpty()) {
                store.saveLayout(request.groupId(), request.path(), request.layout());
            }

            if (offlineFlowIndexService != null) {
                String savedYaml = Files.readString(flowFile, StandardCharsets.UTF_8);
                offlineFlowIndexService.onFlowSaved(request.groupId(), request.path(), savedYaml, flowFile);
            }

            return store.readSnapshot(request.groupId(), request.path()).response();
        } catch (IOException ex) {
            throw new IllegalStateException("保存任务文档失败", ex);
        }
    }

    OfflineFlowDocumentService.CompiledFlowDraft compileDraftUnlocked(DebugDocumentExecutionRequest request) {
        try {
            DocumentSnapshot current = store.readSnapshot(request.groupId(), request.flowPath());
            store.assertOptimisticLock(current, request.documentHash(), request.documentUpdatedAt());

            GraphDraft draft = graphDraftBuilder.prepare(
                    request.groupId(),
                    request.flowPath(),
                    request.stages(),
                    request.edges()
            );
            for (OfflineFlowNode node : draft.nodes()) {
                if ("TRANSFER".equalsIgnoreCase(node.kind()) && draft.transferConfigs().get(node.taskId()) == null) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "传输节点“" + node.taskId() + "”未配置传输规则，无法执行");
                }
            }
            var flowContent = offlineFlowContentService.getFlowContent(request.groupId(), request.flowPath());
            Path repoPath = offlineProperties.resolveRepoPath(request.groupId());
            FlowParameterSnapshot parameterSnapshot = parameterSnapshotStore.read(repoPath, request.flowPath())
                    .map(FlowParameterSnapshotStore.SnapshotFile::snapshot)
                    .orElse(null);
            String compiledYaml = compileGraphYaml(
                    request.groupId(),
                    flowContent.content(),
                    draft,
                    parameterSnapshot
            );
            return new OfflineFlowDocumentService.CompiledFlowDraft(compiledYaml, draft.namespaceFileContents());
        } catch (IOException ex) {
            throw new IllegalStateException("编译任务文档失败", ex);
        }
    }

    private String compileGraphYaml(Long groupId,
                                    String flowSource,
                                    GraphDraft draft,
                                    FlowParameterSnapshot parameterSnapshot) {
        FlowParameterCompiler.Compilation parameterCompilation = parameterCompiler.compile(
                parameterSnapshot,
                draft.nodes(),
                draft.scriptFileContents(),
                draft.transferConfigs()
        );
        String compiledYaml = yamlSupport.compileGraph(
                flowSource,
                draft.nodes(),
                draft.edges(),
                draft.dataSourceMap(),
                parameterCompilation
        );
        return applyParameterSnapshotId(groupId, compiledYaml, parameterSnapshot);
    }

    private String applyParameterSnapshotId(Long groupId,
                                            String flowSource,
                                            FlowParameterSnapshot parameterSnapshot) {
        String snapshotId = parameterSnapshot == null
                ? null
                : executionParameterSnapshotRegistry.register(groupId, parameterSnapshot);
        return yamlSupport.applyParameterSnapshotId(flowSource, snapshotId);
    }

    private void saveWithGraph(SaveOfflineFlowDocumentRequest request,
                               String flowSource,
                               FlowParameterSnapshot parameterSnapshot) throws IOException {
        Path repoPath = offlineProperties.resolveRepoPath(request.groupId());
        GraphDraft graphDraft = graphDraftBuilder.prepare(
                request.groupId(),
                request.path(),
                request.stages(),
                request.edges()
        );
        String compiledYaml = compileGraphYaml(
                request.groupId(),
                flowSource,
                graphDraft,
                parameterSnapshot
        );
        graphDraftBuilder.writeFiles(repoPath, request.groupId(), request.path(), graphDraft);

        Path flowFile = store.resolveRepoFile(repoPath, request.path());
        Files.createDirectories(flowFile.getParent());
        Files.writeString(flowFile, compiledYaml, StandardCharsets.UTF_8);
    }

    private void applyScheduleToFlowFile(Path repoPath, String flowPath, OfflineFlowSchedule schedule) throws IOException {
        Path flowFile = store.resolveRepoFile(repoPath, flowPath);
        String current = Files.readString(flowFile, StandardCharsets.UTF_8);
        Files.writeString(flowFile, yamlSupport.applySchedule(current, schedule), StandardCharsets.UTF_8);
    }

    private void applyRuntimeTimezoneToFlowFile(Path repoPath,
                                                String flowPath,
                                                String runtimeTimezone) throws IOException {
        Path flowFile = store.resolveRepoFile(repoPath, flowPath);
        String current = Files.readString(flowFile, StandardCharsets.UTF_8);
        Files.writeString(flowFile,
                yamlSupport.applyRuntimeTimezoneLabel(current, runtimeTimezone),
                StandardCharsets.UTF_8);
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

    private record LegacyHiveConfResolution(
            List<SaveOfflineFlowStageRequest> mergedStages,
            boolean changed
    ) {
    }

    private LegacyHiveConfResolution syncLegacyHiveConfAndDetectChange(Path repoPath,
                                                                     SaveOfflineFlowDocumentRequest request) throws IOException {
        Map<String, Map<String, String>> existingByNode = hiveConfigStore.read(repoPath, request.path())
                .map(OfflineHiveConfigStore.StoredHiveConfigFile::nodes)
                .orElse(Map.of());
        List<OfflineFlowNode> resolvedNodes = new ArrayList<>();
        List<SaveOfflineFlowStageRequest> mergedStages = new ArrayList<>(request.stages().size());
        Map<String, Map<String, String>> nextByNode = new LinkedHashMap<>();
        for (SaveOfflineFlowStageRequest stage : request.stages()) {
            List<SaveOfflineFlowNodeRequest> mergedNodes = new ArrayList<>(stage.nodes().size());
            for (SaveOfflineFlowNodeRequest node : stage.nodes()) {
                Map<String, String> existingConf = existingByNode.getOrDefault(node.taskId(), Map.of());
                // Preserve existing sidecar hiveConf when legacy callers omit the field (null); explicit Map updates/clears it.
                Map<String, String> effectiveConf = node.hiveConf() == null
                        ? existingConf
                        : OfflineHiveConfigStore.normalizeAndValidateNodeConf(node.kind(), node.hiveConf());
                if (!effectiveConf.isEmpty()) {
                    nextByNode.put(node.taskId(), effectiveConf);
                }
                resolvedNodes.add(new OfflineFlowNode(
                        node.taskId(),
                        node.kind(),
                        node.scriptPath(),
                        node.dataSourceId(),
                        node.dataSourceType(),
                        null,
                        effectiveConf
                ));
                mergedNodes.add(new SaveOfflineFlowNodeRequest(
                        node.taskId(),
                        node.scriptContent(),
                        node.kind(),
                        node.scriptPath(),
                        node.dataSourceId(),
                        node.dataSourceType(),
                        node.transfer(),
                        effectiveConf.isEmpty() ? Map.of() : effectiveConf
                ));
            }
            mergedStages.add(new SaveOfflineFlowStageRequest(stage.stageId(), mergedNodes));
        }
        boolean changed = !orderedNodeConfEquals(existingByNode, nextByNode);
        if (changed) {
            hiveConfigStore.writeForNodes(repoPath, request.path(), resolvedNodes);
        }
        return new LegacyHiveConfResolution(mergedStages, changed);
    }

    private static boolean orderedNodeConfEquals(Map<String, Map<String, String>> left,
                                                 Map<String, Map<String, String>> right) {
        if (left.size() != right.size() || !left.keySet().equals(right.keySet())) {
            return false;
        }
        for (Map.Entry<String, Map<String, String>> entry : left.entrySet()) {
            Map<String, String> rightEntries = right.get(entry.getKey());
            if (rightEntries == null || !List.copyOf(entry.getValue().entrySet()).equals(List.copyOf(rightEntries.entrySet()))) {
                return false;
            }
        }
        return true;
    }

    private void recompileLegacyFlowWithParameters(SaveOfflineFlowDocumentRequest request,
                                                   List<SaveOfflineFlowStageRequest> stages,
                                                   FlowParameterSnapshot parameterSnapshot) throws IOException {
        String flowSource = offlineFlowContentService.getFlowContent(request.groupId(), request.path()).content();
        OfflineFlowYamlSupport.FlowGraph graph = yamlSupport.parseGraph(flowSource);
        List<SaveOfflineFlowEdgeRequest> edges = graph.edges().stream()
                .map(edge -> new SaveOfflineFlowEdgeRequest(edge.source(), edge.target()))
                .toList();
        GraphDraft draft = graphDraftBuilder.prepare(
                request.groupId(),
                request.path(),
                stages,
                edges
        );
        String compiledYaml = compileGraphYaml(
                request.groupId(),
                flowSource,
                draft,
                parameterSnapshot
        );
        Files.writeString(store.resolveRepoFile(
                offlineProperties.resolveRepoPath(request.groupId()), request.path()), compiledYaml, StandardCharsets.UTF_8);
    }

    private String extractFlowId(String path) {
        String[] parts = path.split("/");
        if (parts.length >= 2) {
            return parts[parts.length - 2];
        }
        return "flow";
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

        String existingTimezone = store.readSnapshot(request.groupId(), request.path()).response().runtimeTimezone();
        if (existingTimezone == null || existingTimezone.isBlank()) {
            return requestedTimezone;
        }
        existingTimezone = requireRuntimeTimezone(existingTimezone);
        if (!existingTimezone.equals(requestedTimezone)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "任务运行时区创建后不能修改");
        }
        return existingTimezone;
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
}
