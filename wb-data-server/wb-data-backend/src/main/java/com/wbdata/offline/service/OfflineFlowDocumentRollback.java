package com.wbdata.offline.service;

import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.dto.OfflineFlowDocumentResponse;
import com.wbdata.offline.dto.OfflineFlowNodeResponse;
import com.wbdata.offline.dto.OfflineFlowStageResponse;
import com.wbdata.offline.dto.RollbackOfflineFlowRequest;
import com.wbdata.offline.dto.RollbackOfflineFlowResponse;
import com.wbdata.offline.parameter.dto.FlowParameterBindingResponse;
import com.wbdata.offline.parameter.dto.FlowParameterSnapshot;
import com.wbdata.offline.parameter.service.ExecutionParameterSnapshotRegistry;
import com.wbdata.offline.parameter.service.FlowParameterBindingAssembler;
import com.wbdata.offline.parameter.service.FlowParameterBindingAssembler.ParameterSnapshotUpdate;
import com.wbdata.offline.parameter.service.FlowParameterSnapshotStore;
import com.wbdata.offline.repo.service.SnapshotFileAccess;
import com.wbdata.offline.service.OfflineFlowDocumentStore.DocumentSnapshot;
import com.wbdata.offline.transfer.dto.TransferConfig;
import com.wbdata.offline.transfer.service.TransferConfigFileService;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;

/**
 * 离线任务文档工作区回滚执行器（调用方必须已持有依赖图锁及仓库锁）。
 */
final class OfflineFlowDocumentRollback {

    private final OfflineProperties offlineProperties;
    private final OfflineKestraFlowFileService kestraFlowFileService;
    private final TransferConfigFileService transferConfigFileService;
    private final FlowParameterSnapshotStore parameterSnapshotStore;
    private final FlowParameterBindingAssembler parameterBindingAssembler;
    private final FlowGraphDraftBuilder graphDraftBuilder;
    private final ExecutionParameterSnapshotRegistry executionParameterSnapshotRegistry;
    private final OfflineHiveConfigStore hiveConfigStore;
    private final OfflineFlowYamlSupport yamlSupport;
    private final OfflineFlowDocumentStore store;

    OfflineFlowDocumentRollback(OfflineProperties offlineProperties,
                                OfflineKestraFlowFileService kestraFlowFileService,
                                TransferConfigFileService transferConfigFileService,
                                FlowParameterSnapshotStore parameterSnapshotStore,
                                FlowParameterBindingAssembler parameterBindingAssembler,
                                FlowGraphDraftBuilder graphDraftBuilder,
                                ExecutionParameterSnapshotRegistry executionParameterSnapshotRegistry,
                                OfflineHiveConfigStore hiveConfigStore,
                                OfflineFlowYamlSupport yamlSupport,
                                OfflineFlowDocumentStore store) {
        this.offlineProperties = offlineProperties;
        this.kestraFlowFileService = kestraFlowFileService;
        this.transferConfigFileService = transferConfigFileService;
        this.parameterSnapshotStore = parameterSnapshotStore;
        this.parameterBindingAssembler = parameterBindingAssembler;
        this.graphDraftBuilder = graphDraftBuilder;
        this.executionParameterSnapshotRegistry = executionParameterSnapshotRegistry;
        this.hiveConfigStore = hiveConfigStore;
        this.yamlSupport = yamlSupport;
        this.store = store;
    }

    RollbackOfflineFlowResponse rollbackUnlocked(RollbackOfflineFlowRequest request,
                                                 SnapshotFileAccess revisionAccess,
                                                 OfflineFlowDocumentService.DependencyRollbackValidator dependencyValidator) {
        try {
            Path repoPath = offlineProperties.resolveRepoPath(request.groupId());
            Path flowFile = store.resolveRepoFile(repoPath, request.path());
            OfflineRecentFlowService.assertNotReservedRootPath(repoPath, flowFile);

            DocumentSnapshot current = Files.exists(flowFile)
                    ? store.readSnapshot(request.groupId(), request.path())
                    : null;
            store.assertOptimisticLock(current, request.documentHash(), request.documentUpdatedAt());

            if (!revisionAccess.exists(repoPath, request.path())) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "目标版本不存在或未包含该任务");
            }

            DocumentSnapshot targetSnapshot = store.readSnapshot(request.groupId(), request.path(), revisionAccess);
            String targetFlowContent = revisionAccess.readString(repoPath, request.path());

            List<String> warnings = new ArrayList<>(dependencyValidator.validate(targetFlowContent));

            String effectiveTimezone = targetSnapshot.response().runtimeTimezone();
            if (effectiveTimezone == null || effectiveTimezone.isBlank()) {
                effectiveTimezone = current == null ? null : current.response().runtimeTimezone();
            }
            if (effectiveTimezone != null && !effectiveTimezone.isBlank()
                    && !Objects.equals(yamlSupport.readLabel(targetFlowContent, "wbdataRuntimeTimezone"), effectiveTimezone.trim())) {
                targetFlowContent = yamlSupport.applyRuntimeTimezoneLabel(targetFlowContent, effectiveTimezone);
            }

            Set<String> invalidSqlDataSourceTaskIds = new LinkedHashSet<>();
            Map<String, String> nodeIssues = new LinkedHashMap<>();
            collectInvalidDataSources(request.groupId(), targetSnapshot.response(), invalidSqlDataSourceTaskIds, nodeIssues, warnings);
            if (!invalidSqlDataSourceTaskIds.isEmpty()) {
                targetFlowContent = yamlSupport.unbindSqlDataSources(targetFlowContent, invalidSqlDataSourceTaskIds);
            }

            targetFlowContent = restoreParameterSnapshotForRollback(
                    repoPath, request.groupId(), request.path(), effectiveTimezone, targetFlowContent, revisionAccess);
            restoreManagedNodeFilesForRollback(repoPath, request.path(), current, targetSnapshot, revisionAccess);
            restoreSidecarFile(repoPath, store.resolveLayoutFile(repoPath, request.path()), revisionAccess);
            restoreSidecarFile(repoPath, hiveConfigStore.resolveConfigFile(repoPath, request.path()), revisionAccess);

            Files.createDirectories(flowFile.getParent());
            Files.writeString(flowFile, targetFlowContent, StandardCharsets.UTF_8);
            kestraFlowFileService.syncFlowFile(repoPath, request.path());

            OfflineFlowDocumentResponse restored = store.readSnapshot(request.groupId(), request.path()).response();
            FlowParameterBindingResponse restoredBinding = restored.parameterBinding();
            if (restoredBinding != null && restoredBinding.status() != null && !"CURRENT".equals(restoredBinding.status())) {
                warnings.add(describeParameterBindingWarning(restoredBinding.status()));
            }
            return new RollbackOfflineFlowResponse(restored, List.copyOf(warnings), Map.copyOf(nodeIssues));
        } catch (IOException ex) {
            throw new IllegalStateException("回滚任务文档失败", ex);
        }
    }

    private void collectInvalidDataSources(Long groupId,
                                           OfflineFlowDocumentResponse targetDocument,
                                           Set<String> invalidSqlDataSourceTaskIds,
                                           Map<String, String> nodeIssues,
                                           List<String> warnings) {
        if (targetDocument.stages() == null) {
            return;
        }
        for (OfflineFlowStageResponse stage : targetDocument.stages()) {
            if (stage.nodes() == null) {
                continue;
            }
            for (OfflineFlowNodeResponse node : stage.nodes()) {
                if ("TRANSFER".equalsIgnoreCase(node.kind())) {
                    TransferConfig transfer = node.transfer();
                    if (transfer != null) {
                        boolean sourceInvalid = transfer.source() != null
                                && transfer.source().dataSourceId() != null
                                && !graphDraftBuilder.isValidGroupDataSource(groupId, transfer.source().dataSourceId());
                        boolean targetInvalid = transfer.target() != null
                                && transfer.target().dataSourceId() != null
                                && !graphDraftBuilder.isValidGroupDataSource(groupId, transfer.target().dataSourceId());
                        if (sourceInvalid || targetInvalid) {
                            nodeIssues.put(node.taskId(), "引用的数据源已不存在，请重新配置传输规则");
                            warnings.add("传输节点「" + node.taskId() + "」引用的数据源已不存在，请重新配置传输节点");
                        }
                    }
                } else if (node.dataSourceId() != null
                        && !graphDraftBuilder.isValidGroupDataSource(groupId, node.dataSourceId())) {
                    invalidSqlDataSourceTaskIds.add(node.taskId());
                    warnings.add("节点「" + node.taskId() + "」原绑定的数据源（ID: " + node.dataSourceId() + "）已不存在，已解除绑定，请重新选择数据源");
                }
            }
        }
    }

    private String restoreParameterSnapshotForRollback(Path repoPath,
                                                       Long groupId,
                                                       String flowPath,
                                                       String effectiveTimezone,
                                                       String flowContent,
                                                       SnapshotFileAccess revisionAccess) throws IOException {
        Optional<FlowParameterSnapshotStore.SnapshotFile> targetParamFile =
                parameterSnapshotStore.read(repoPath, flowPath, revisionAccess);
        if (targetParamFile.isEmpty()) {
            parameterSnapshotStore.delete(repoPath, flowPath);
            if (yamlSupport.readLabel(flowContent, ExecutionParameterSnapshotRegistry.LABEL_KEY) != null) {
                return yamlSupport.applyParameterSnapshotId(flowContent, null);
            }
            return flowContent;
        }

        FlowParameterSnapshot targetParam = targetParamFile.get().snapshot();
        FlowParameterSnapshot snapshotToRegister = targetParam;
        Path paramFile = parameterSnapshotStore.resolve(repoPath, flowPath);
        if (effectiveTimezone != null && !effectiveTimezone.isBlank()) {
            ParameterSnapshotUpdate normalized = parameterBindingAssembler.normalizeParameterSnapshotForSave(
                    new ParameterSnapshotUpdate(true, targetParam), targetParam, effectiveTimezone);
            snapshotToRegister = normalized.snapshot();
            if (targetParam.schemaVersion() == 2 && snapshotToRegister.equals(targetParam)) {
                Files.createDirectories(paramFile.getParent());
                Files.writeString(paramFile, targetParamFile.get().content(), StandardCharsets.UTF_8);
            } else {
                parameterSnapshotStore.write(repoPath, flowPath, snapshotToRegister);
            }
        } else {
            Files.createDirectories(paramFile.getParent());
            Files.writeString(paramFile, targetParamFile.get().content(), StandardCharsets.UTF_8);
        }

        if (snapshotToRegister.schemaVersion() == 2
                && snapshotToRegister.runtimeTimezone() != null
                && !snapshotToRegister.runtimeTimezone().isBlank()) {
            String snapshotId = executionParameterSnapshotRegistry.register(groupId, snapshotToRegister);
            if (snapshotId != null && !snapshotId.isBlank()) {
                String existingSnapshotId = yamlSupport.readLabel(flowContent, ExecutionParameterSnapshotRegistry.LABEL_KEY);
                if (!snapshotId.equals(existingSnapshotId)) {
                    return yamlSupport.applyParameterSnapshotId(flowContent, snapshotId);
                }
            }
        }
        return flowContent;
    }

    private void restoreManagedNodeFilesForRollback(Path repoPath,
                                                    String flowPath,
                                                    DocumentSnapshot current,
                                                    DocumentSnapshot targetSnapshot,
                                                    SnapshotFileAccess revisionAccess) throws IOException {
        Path paramPath = parameterSnapshotStore.resolve(repoPath, flowPath).normalize();
        Path hiveConfPath = hiveConfigStore.resolveConfigFile(repoPath, flowPath).normalize();
        Set<String> activeScriptPaths = new LinkedHashSet<>();
        Set<String> activeTransferPaths = new LinkedHashSet<>();
        for (Path targetManaged : targetSnapshot.managedNodeFiles()) {
            Path normalizedManaged = targetManaged.normalize();
            if (normalizedManaged.equals(paramPath) || normalizedManaged.equals(hiveConfPath)) {
                continue;
            }
            String relPath = repoPath.relativize(normalizedManaged).toString().replace('\\', '/');
            String fileContent = revisionAccess.readString(repoPath, relPath);
            Files.createDirectories(normalizedManaged.getParent());
            Files.writeString(normalizedManaged, fileContent, StandardCharsets.UTF_8);
            if (targetSnapshot.taskFiles().containsValue(targetManaged)) {
                activeScriptPaths.add(relPath);
            } else {
                activeTransferPaths.add(relPath);
            }
        }
        if (current != null) {
            for (Path oldManaged : current.managedNodeFiles()) {
                if (!targetSnapshot.managedNodeFiles().contains(oldManaged)) {
                    Files.deleteIfExists(oldManaged);
                }
            }
        }
        transferConfigFileService.deleteStaleForFlow(repoPath, flowPath, activeTransferPaths);
        graphDraftBuilder.deleteStaleScriptsForFlow(repoPath, flowPath, activeScriptPaths);
    }

    private void restoreSidecarFile(Path repoPath, Path sidecarFile, SnapshotFileAccess revisionAccess) throws IOException {
        String relPath = repoPath.relativize(sidecarFile).toString().replace('\\', '/');
        if (revisionAccess.exists(repoPath, relPath)) {
            Files.createDirectories(sidecarFile.getParent());
            Files.writeString(sidecarFile, revisionAccess.readString(repoPath, relPath), StandardCharsets.UTF_8);
        } else {
            Files.deleteIfExists(sidecarFile);
        }
    }

    private String describeParameterBindingWarning(String status) {
        return switch (status) {
            case "MISSING" -> "回滚版本绑定的参数组已不存在，请打开「参数」弹窗检查或重新绑定";
            case "ARCHIVED" -> "回滚版本绑定的参数组已归档，请打开「参数」弹窗检查或调整";
            case "OUTDATED" -> "回滚版本使用的参数组版本落后于当前最新版本，如需同步请打开「参数」弹窗更新";
            default -> "参数组绑定状态需要检查（" + status + "），请打开「参数」弹窗确认";
        };
    }
}
