package com.wbdata.offline.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.dto.NodePosition;
import com.wbdata.offline.dto.OfflineFlowDocumentResponse;
import com.wbdata.offline.dto.OfflineFlowEdgeResponse;
import com.wbdata.offline.dto.OfflineFlowNodeResponse;
import com.wbdata.offline.dto.OfflineFlowStageResponse;
import com.wbdata.offline.parameter.dto.FlowParameterBindingResponse;
import com.wbdata.offline.parameter.service.FlowParameterBindingAssembler;
import com.wbdata.offline.parameter.service.FlowParameterSnapshotStore;
import com.wbdata.offline.repo.service.SnapshotFileAccess;
import com.wbdata.offline.repo.service.WorkingTreeSnapshotFileAccess;
import com.wbdata.offline.schedule.dto.OfflineFlowSchedule;
import com.wbdata.offline.transfer.dto.TransferConfig;
import com.wbdata.offline.transfer.service.TransferConfigFileService;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * 离线任务文档快照读写与路径/乐观锁原语（调用方必须已持有仓库锁）。
 */
final class OfflineFlowDocumentStore {

    record DocumentSnapshot(
            OfflineFlowDocumentResponse response,
            Map<String, Path> taskFiles,
            Set<Path> managedNodeFiles,
            List<String> stageOrder,
            List<String> taskOrder
    ) {
    }

    private final OfflineProperties offlineProperties;
    private final OfflineKestraFlowFileService kestraFlowFileService;
    private final TransferConfigFileService transferConfigFileService;
    private final FlowParameterSnapshotStore parameterSnapshotStore;
    private final FlowParameterBindingAssembler parameterBindingAssembler;
    private final OfflineHiveConfigStore hiveConfigStore;
    private final OfflineFlowYamlSupport yamlSupport;
    private final ObjectMapper objectMapper;

    OfflineFlowDocumentStore(OfflineProperties offlineProperties,
                             OfflineKestraFlowFileService kestraFlowFileService,
                             TransferConfigFileService transferConfigFileService,
                             FlowParameterSnapshotStore parameterSnapshotStore,
                             FlowParameterBindingAssembler parameterBindingAssembler,
                             OfflineHiveConfigStore hiveConfigStore,
                             OfflineFlowYamlSupport yamlSupport,
                             ObjectMapper objectMapper) {
        this.offlineProperties = offlineProperties;
        this.kestraFlowFileService = kestraFlowFileService;
        this.transferConfigFileService = transferConfigFileService;
        this.parameterSnapshotStore = parameterSnapshotStore;
        this.parameterBindingAssembler = parameterBindingAssembler;
        this.hiveConfigStore = hiveConfigStore;
        this.yamlSupport = yamlSupport;
        this.objectMapper = objectMapper;
    }

    DocumentSnapshot readSnapshot(Long groupId, String path) throws IOException {
        return readSnapshot(groupId, path, new WorkingTreeSnapshotFileAccess());
    }

    DocumentSnapshot readSnapshot(Long groupId, String path, SnapshotFileAccess fileAccess) throws IOException {
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        String flowContent = fileAccess.readString(repoPath, path);

        OfflineFlowYamlSupport.FlowDocument document = yamlSupport.parseDocument(flowContent);
        OfflineFlowYamlSupport.FlowGraph graph = yamlSupport.parseGraph(flowContent);
        OfflineFlowYamlSupport.ScheduleData scheduleData = yamlSupport.readSchedule(flowContent);
        OfflineFlowSchedule schedule = scheduleData == null
                ? null
                : new OfflineFlowSchedule(
                        scheduleData.cron(),
                        scheduleData.timezone(),
                        scheduleData.enabled(),
                        scheduleData.period()
                );

        List<OfflineFlowStageResponse> stages = new ArrayList<>();
        Map<String, Path> taskFiles = new LinkedHashMap<>();
        Set<Path> managedNodeFiles = new LinkedHashSet<>();
        Set<String> seenTaskIds = new LinkedHashSet<>();
        List<String> stageKeys = new ArrayList<>();
        List<String> taskOrder = new ArrayList<>();
        long updatedAt = fileAccess.lastModified(repoPath, path);
        StringBuilder signature = new StringBuilder()
                .append(path)
                .append('\n')
                .append(flowContent);

        Optional<FlowParameterSnapshotStore.SnapshotFile> parameterFile =
                parameterSnapshotStore.read(repoPath, path, fileAccess);
        FlowParameterBindingResponse parameterBinding = null;
        if (parameterFile.isPresent()) {
            FlowParameterSnapshotStore.SnapshotFile file = parameterFile.get();
            updatedAt = Math.max(updatedAt, file.updatedAt());
            signature.append('\n')
                    .append(file.path().getFileName())
                    .append('\n')
                    .append(file.content());
            managedNodeFiles.add(file.path());
            parameterBinding = parameterBindingAssembler.resolveParameterBinding(groupId, file.snapshot());
        }

        Optional<OfflineHiveConfigStore.StoredHiveConfigFile> hiveConfigFile =
                hiveConfigStore.read(repoPath, path, fileAccess);
        Map<String, Map<String, String>> hiveConfByNode = Map.of();
        if (hiveConfigFile.isPresent()) {
            OfflineHiveConfigStore.StoredHiveConfigFile file = hiveConfigFile.get();
            updatedAt = Math.max(updatedAt, file.updatedAt());
            signature.append('\n')
                    .append(file.path().getFileName())
                    .append('\n')
                    .append(file.content());
            managedNodeFiles.add(file.path());
            hiveConfByNode = file.nodes();
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
                    TransferConfig transfer = null;
                    if (node.transferConfigPath() != null) {
                        Path transferFile = resolveRepoFile(repoPath, node.transferConfigPath());
                        if (fileAccess.exists(repoPath, node.transferConfigPath())) {
                            String transferContent = fileAccess.readString(repoPath, node.transferConfigPath());
                            transfer = transferConfigFileService.readContent(node.transferConfigPath(), transferContent);
                            updatedAt = Math.max(updatedAt, fileAccess.lastModified(repoPath, node.transferConfigPath()));
                            signature.append('\n')
                                    .append(node.taskId())
                                    .append('\n')
                                    .append(node.transferConfigPath())
                                    .append('\n')
                                    .append(transferContent);
                            managedNodeFiles.add(transferFile);
                        }
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
                    if (!fileAccess.exists(repoPath, node.scriptPath())) {
                        throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                                "脚本文件不存在: " + node.scriptPath());
                    }
                    String scriptContent = fileAccess.readString(repoPath, node.scriptPath());
                    updatedAt = Math.max(updatedAt, fileAccess.lastModified(repoPath, node.scriptPath()));
                    signature.append('\n')
                            .append(node.taskId())
                            .append('\n')
                            .append(node.scriptPath())
                            .append('\n')
                            .append(scriptContent);
                    taskFiles.put(node.taskId(), scriptFile);
                    managedNodeFiles.add(scriptFile);
                    Map<String, String> nodeHiveConf = "HIVE_SQL".equalsIgnoreCase(node.kind())
                            ? hiveConfByNode.get(node.taskId())
                            : null;
                    if (nodeHiveConf != null && nodeHiveConf.isEmpty()) {
                        nodeHiveConf = null;
                    }
                    nodes.add(new OfflineFlowNodeResponse(
                            node.taskId(),
                            node.kind(),
                            node.scriptPath(),
                            scriptContent,
                            node.dataSourceId(),
                            node.dataSourceType(),
                            null,
                            nodeHiveConf
                    ));
                }
            }
            stages.add(new OfflineFlowStageResponse(stage.stageId(), stage.parallel(), nodes));
        }

        List<OfflineFlowEdgeResponse> edges = graph.edges().stream()
                .map(e -> new OfflineFlowEdgeResponse(e.source(), e.target()))
                .toList();

        Map<String, NodePosition> layout = readLayout(groupId, path, fileAccess);

        String runtimeTimezone = yamlSupport.readLabel(flowContent, "wbdataRuntimeTimezone");
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
                        runtimeTimezone,
                        yamlSupport.readDependencyConfig(flowContent)
                ),
                taskFiles,
                managedNodeFiles,
                stageKeys,
                taskOrder
        );
    }

    List<String> collectManagedFiles(Long groupId,
                                     String path,
                                     SnapshotFileAccess fileAccess,
                                     DocumentSnapshot snapshot) throws IOException {
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        LinkedHashSet<String> files = new LinkedHashSet<>();
        files.add(path);
        Path layoutFile = resolveLayoutFile(repoPath, path);
        String layoutRelative = repoPath.relativize(layoutFile).toString().replace('\\', '/');
        if (fileAccess.exists(repoPath, layoutRelative)) {
            files.add(layoutRelative);
        }
        Path kestraFlowFile = kestraFlowFileService.resolveFlowFile(repoPath, path);
        String kestraRelative = repoPath.relativize(kestraFlowFile).toString().replace('\\', '/');
        if (fileAccess.exists(repoPath, kestraRelative)) {
            files.add(kestraRelative);
        }
        for (Path taskFile : snapshot.managedNodeFiles()) {
            files.add(repoPath.relativize(taskFile).toString().replace('\\', '/'));
        }
        return List.copyOf(files);
    }

    Map<String, NodePosition> readLayout(Long groupId, String path, SnapshotFileAccess fileAccess) {
        try {
            Path repoPath = offlineProperties.resolveRepoPath(groupId);
            Path layoutFile = resolveLayoutFile(repoPath, path);
            String relativePath = repoPath.relativize(layoutFile).toString().replace('\\', '/');
            if (!fileAccess.exists(repoPath, relativePath)) {
                return Collections.emptyMap();
            }
            String content = fileAccess.readString(repoPath, relativePath);
            return objectMapper.readValue(content, new TypeReference<>() {});
        } catch (IOException ex) {
            return Collections.emptyMap();
        }
    }

    void saveLayout(Long groupId, String path, Map<String, NodePosition> layout) throws IOException {
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        Path layoutFile = resolveLayoutFile(repoPath, path);
        Files.createDirectories(layoutFile.getParent());
        String json = objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(layout);
        Files.writeString(layoutFile, json, StandardCharsets.UTF_8);
    }

    Path resolveLayoutFile(Path repoPath, String flowPath) {
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

    Path resolveRepoFile(Path repoPath, String path) {
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

    void assertOptimisticLock(DocumentSnapshot current, String documentHash, Long documentUpdatedAt) {
        if (documentHash == null) {
            return;
        }
        if (current == null
                || !current.response().documentHash().equals(documentHash)
                || (documentUpdatedAt != null && current.response().documentUpdatedAt() != documentUpdatedAt)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "检测到文件已被修改，请先加载最新内容");
        }
    }
}
