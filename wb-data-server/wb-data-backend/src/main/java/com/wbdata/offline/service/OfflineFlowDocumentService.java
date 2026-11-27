package com.wbdata.offline.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wbdata.group.dto.GroupOwnerInfo;
import com.wbdata.group.service.GroupOwnerService;
import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.config.OfflineTransferProperties;
import com.wbdata.offline.dto.OfflineFlowDocumentResponse;
import com.wbdata.offline.dto.OfflineFlowNodeResponse;
import com.wbdata.offline.dto.OfflineFlowStageResponse;
import com.wbdata.offline.dto.RollbackOfflineFlowRequest;
import com.wbdata.offline.dto.RollbackOfflineFlowResponse;
import com.wbdata.offline.dto.SaveOfflineFlowDocumentRequest;
import com.wbdata.offline.execution.dto.DebugDocumentExecutionRequest;
import com.wbdata.offline.parameter.dto.FlowParameterBindingItemResponse;
import com.wbdata.offline.parameter.dto.FlowParameterBindingResponse;
import com.wbdata.offline.parameter.dto.FlowParameterDefinitionSnapshot;
import com.wbdata.offline.parameter.service.ExecutionParameterSnapshotRegistry;
import com.wbdata.offline.parameter.service.FlowParameterBindingAssembler;
import com.wbdata.offline.parameter.service.FlowParameterSnapshotStore;
import com.wbdata.offline.parameter.service.ScriptParameterRenderer;
import com.wbdata.offline.repo.service.RepoLockManager;
import com.wbdata.offline.repo.service.SnapshotFileAccess;
import com.wbdata.offline.repo.service.WorkingTreeSnapshotFileAccess;
import com.wbdata.offline.service.OfflineFlowDocumentStore.DocumentSnapshot;
import com.wbdata.offline.transfer.service.TransferConfigFileService;
import com.wbdata.offline.transfer.service.TransferParameters;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.lang.Nullable;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 离线任务文档的加锁协调门面：统一管理仓库锁并委托快照读写、保存编译、工作区回滚与参数引用扫描。
 * 具体职责见 {@link OfflineFlowDocumentStore} / {@link OfflineFlowDocumentWriter} / {@link OfflineFlowDocumentRollback}。
 */
@Service
public class OfflineFlowDocumentService {

    @FunctionalInterface
    public interface DependencyRollbackValidator {
        List<String> validate(String targetFlowContent);
    }

    public record CompiledFlowDraft(
            String content,
            Map<String, String> namespaceFileContents
    ) {
    }

    public record VersionSnapshotData(
            OfflineFlowDocumentResponse document,
            List<String> managedFiles
    ) {
    }

    private final RepoLockManager repoLockManager;
    private final SqlNamedParameterScanner namedParameterScanner = new SqlNamedParameterScanner();
    private final OfflineFlowDocumentStore store;
    private final OfflineFlowDocumentWriter writer;
    private final OfflineFlowDocumentRollback rollback;
    @Nullable
    private GroupOwnerService groupOwnerService;

    public OfflineFlowDocumentService(OfflineProperties offlineProperties,
                                      OfflineFlowContentService offlineFlowContentService,
                                      RepoLockManager repoLockManager,
                                      OfflineKestraFlowFileService kestraFlowFileService,
                                      TransferConfigFileService transferConfigFileService,
                                      FlowParameterSnapshotStore parameterSnapshotStore,
                                      FlowParameterBindingAssembler parameterBindingAssembler,
                                      FlowGraphDraftBuilder graphDraftBuilder,
                                      ExecutionParameterSnapshotRegistry executionParameterSnapshotRegistry,
                                      OfflineTransferProperties transferProperties) {
        this(
                offlineProperties,
                offlineFlowContentService,
                repoLockManager,
                kestraFlowFileService,
                transferConfigFileService,
                parameterSnapshotStore,
                parameterBindingAssembler,
                graphDraftBuilder,
                executionParameterSnapshotRegistry,
                transferProperties,
                new OfflineHiveConfigStore(new ObjectMapper())
        );
    }

    public OfflineFlowDocumentService(OfflineProperties offlineProperties,
                                      OfflineFlowContentService offlineFlowContentService,
                                      RepoLockManager repoLockManager,
                                      OfflineKestraFlowFileService kestraFlowFileService,
                                      TransferConfigFileService transferConfigFileService,
                                      FlowParameterSnapshotStore parameterSnapshotStore,
                                      FlowParameterBindingAssembler parameterBindingAssembler,
                                      FlowGraphDraftBuilder graphDraftBuilder,
                                      ExecutionParameterSnapshotRegistry executionParameterSnapshotRegistry,
                                      OfflineTransferProperties transferProperties,
                                      OfflineHiveConfigStore hiveConfigStore) {
        this(
                offlineProperties,
                offlineFlowContentService,
                repoLockManager,
                kestraFlowFileService,
                transferConfigFileService,
                parameterSnapshotStore,
                parameterBindingAssembler,
                graphDraftBuilder,
                executionParameterSnapshotRegistry,
                transferProperties,
                hiveConfigStore,
                null
        );
    }

    @Autowired
    public OfflineFlowDocumentService(OfflineProperties offlineProperties,
                                      OfflineFlowContentService offlineFlowContentService,
                                      RepoLockManager repoLockManager,
                                      OfflineKestraFlowFileService kestraFlowFileService,
                                      TransferConfigFileService transferConfigFileService,
                                      FlowParameterSnapshotStore parameterSnapshotStore,
                                      FlowParameterBindingAssembler parameterBindingAssembler,
                                      FlowGraphDraftBuilder graphDraftBuilder,
                                      ExecutionParameterSnapshotRegistry executionParameterSnapshotRegistry,
                                      OfflineTransferProperties transferProperties,
                                      OfflineHiveConfigStore hiveConfigStore,
                                      @Nullable OfflineFlowIndexService offlineFlowIndexService) {
        this.repoLockManager = repoLockManager;
        OfflineFlowYamlSupport yamlSupport = new OfflineFlowYamlSupport(transferProperties);
        FlowParameterCompiler parameterCompiler = new FlowParameterCompiler();
        ObjectMapper objectMapper = new ObjectMapper();
        this.store = new OfflineFlowDocumentStore(
                offlineProperties,
                kestraFlowFileService,
                transferConfigFileService,
                parameterSnapshotStore,
                parameterBindingAssembler,
                hiveConfigStore,
                yamlSupport,
                objectMapper
        );
        this.writer = new OfflineFlowDocumentWriter(
                offlineProperties,
                offlineFlowContentService,
                kestraFlowFileService,
                parameterSnapshotStore,
                parameterBindingAssembler,
                graphDraftBuilder,
                executionParameterSnapshotRegistry,
                hiveConfigStore,
                yamlSupport,
                parameterCompiler,
                store,
                offlineFlowIndexService
        );
        this.rollback = new OfflineFlowDocumentRollback(
                offlineProperties,
                kestraFlowFileService,
                transferConfigFileService,
                parameterSnapshotStore,
                parameterBindingAssembler,
                graphDraftBuilder,
                executionParameterSnapshotRegistry,
                hiveConfigStore,
                yamlSupport,
                store,
                offlineFlowIndexService
        );
    }

    @Autowired(required = false)
    public void setGroupOwnerService(@Nullable GroupOwnerService groupOwnerService) {
        this.groupOwnerService = groupOwnerService;
    }

    public OfflineFlowDocumentResponse getFlowDocument(Long groupId, String path) {
        return repoLockManager.withLock(groupId, () -> {
            try {
                return enrichOwner(groupId, store.readSnapshot(groupId, path).response());
            } catch (IOException ex) {
                throw new IllegalStateException("读取任务文档失败", ex);
            }
        });
    }

    public VersionSnapshotData getVersionSnapshotData(Long groupId, String path, SnapshotFileAccess fileAccess) {
        return repoLockManager.withLock(groupId, () -> {
            try {
                DocumentSnapshot snapshot = store.readSnapshot(groupId, path, fileAccess);
                return new VersionSnapshotData(
                        enrichOwner(groupId, snapshot.response()),
                        store.collectManagedFiles(groupId, path, fileAccess, snapshot)
                );
            } catch (IOException ex) {
                throw new IllegalStateException("读取任务快照失败", ex);
            }
        });
    }

    public OfflineFlowDocumentResponse getFlowDocumentSnapshot(Long groupId, String path, SnapshotFileAccess fileAccess) {
        return repoLockManager.withLock(groupId, () -> {
            try {
                return enrichOwner(groupId, store.readSnapshot(groupId, path, fileAccess).response());
            } catch (IOException ex) {
                throw new IllegalStateException("读取任务快照失败", ex);
            }
        });
    }

    public List<String> resolveManagedFilesAtRevision(Long groupId, String path, SnapshotFileAccess fileAccess) {
        return repoLockManager.withLock(groupId, () -> {
            try {
                DocumentSnapshot snapshot = store.readSnapshot(groupId, path, fileAccess);
                return store.collectManagedFiles(groupId, path, fileAccess, snapshot);
            } catch (IOException ex) {
                throw new IllegalStateException("解析历史任务关联文件失败", ex);
            }
        });
    }

    public Map<String, List<String>> extractReferencedParameters(OfflineFlowDocumentResponse document) {
        if (document == null || document.stages() == null) {
            return Map.of();
        }
        Set<String> definedNames = extractDefinedParameterNames(document.parameterBinding());
        Map<String, List<String>> result = new LinkedHashMap<>();
        for (OfflineFlowStageResponse stage : document.stages()) {
            if (stage.nodes() == null) {
                continue;
            }
            for (OfflineFlowNodeResponse node : stage.nodes()) {
                result.put(node.taskId(), extractNodeReferencedParameters(node, definedNames));
            }
        }
        return result;
    }

    /** Persistence callback; API callers must enter OfflineFlowDependencyService.saveDocument first. */
    public OfflineFlowDocumentResponse saveFlowDocument(SaveOfflineFlowDocumentRequest request) {
        return saveFlowDocument(request, null, true);
    }

    public OfflineFlowDocumentResponse saveFlowDocument(SaveOfflineFlowDocumentRequest request,
                                                        @Nullable Long operatorUserId,
                                                        boolean canManageOthersOwnership) {
        OfflineFlowDocumentResponse saved = repoLockManager.withLock(
                request.groupId(),
                () -> writer.saveUnlocked(request, operatorUserId, canManageOthersOwnership, groupOwnerService)
        );
        return enrichOwner(request.groupId(), saved);
    }

    private OfflineFlowDocumentResponse enrichOwner(Long groupId, @Nullable OfflineFlowDocumentResponse response) {
        if (response == null || response.ownerUserId() == null || groupOwnerService == null) {
            return response;
        }
        Map<Long, GroupOwnerInfo> resolved = groupOwnerService.resolveOwners(groupId, List.of(response.ownerUserId()));
        GroupOwnerInfo info = resolved.get(response.ownerUserId());
        if (info == null) {
            return response;
        }
        return response.withOwner(
                response.ownerUserId(),
                info.effectiveName(),
                info.username(),
                info.status()
        );
    }

    /**
     * Rolls back the target flow's working tree files to the specified historical revision.
     * Callers must enter OfflineFlowDependencyService.rollbackDocument first so lock ordering
     * stays graph-lock -> group-lock.
     */
    public RollbackOfflineFlowResponse rollbackFlowDocument(RollbackOfflineFlowRequest request,
                                                            SnapshotFileAccess revisionAccess,
                                                            DependencyRollbackValidator dependencyValidator) {
        return repoLockManager.withLock(request.groupId(),
                () -> rollback.rollbackUnlocked(request, revisionAccess, dependencyValidator));
    }

    public List<String> resolveManagedFiles(Long groupId, String path) {
        return repoLockManager.withLock(groupId, () -> {
            try {
                SnapshotFileAccess workingTree = new WorkingTreeSnapshotFileAccess();
                DocumentSnapshot snapshot = store.readSnapshot(groupId, path, workingTree);
                return store.collectManagedFiles(groupId, path, workingTree, snapshot);
            } catch (IOException ex) {
                throw new IllegalStateException("解析任务关联文件失败", ex);
            }
        });
    }

    public CompiledFlowDraft compileFlowDraft(DebugDocumentExecutionRequest request) {
        return repoLockManager.withLock(request.groupId(), () -> writer.compileDraftUnlocked(request));
    }

    private Set<String> extractDefinedParameterNames(FlowParameterBindingResponse binding) {
        if (binding == null) {
            return Set.of();
        }
        LinkedHashSet<String> names = new LinkedHashSet<>();
        if (binding.definitions() != null) {
            for (FlowParameterDefinitionSnapshot def : binding.definitions()) {
                if (def != null && def.key() != null && !def.key().isBlank()) {
                    names.add(def.key());
                }
            }
        }
        if (binding.bindings() != null) {
            for (FlowParameterBindingItemResponse item : binding.bindings()) {
                if (item != null && item.definitions() != null) {
                    for (FlowParameterDefinitionSnapshot def : item.definitions()) {
                        if (def != null && def.key() != null && !def.key().isBlank()) {
                            names.add(def.key());
                        }
                    }
                }
            }
        }
        return Set.copyOf(names);
    }

    private List<String> extractNodeReferencedParameters(OfflineFlowNodeResponse node, Set<String> definedNames) {
        try {
            if ("TRANSFER".equalsIgnoreCase(node.kind())) {
                return node.transfer() == null ? List.of() : List.copyOf(TransferParameters.references(node.transfer()));
            }
            String script = node.scriptContent();
            if (script == null) {
                return List.of();
            }
            if ("HIVE_SQL".equalsIgnoreCase(node.kind()) || "HIVE".equalsIgnoreCase(node.dataSourceType())) {
                return List.copyOf(ScriptParameterRenderer.hiveReferences(script, definedNames));
            }
            if ("SHELL".equalsIgnoreCase(node.kind())) {
                return List.copyOf(ScriptParameterRenderer.shellReferences(script, definedNames));
            }
            return List.copyOf(namedParameterScanner.scan(script).parameters());
        } catch (IllegalArgumentException ex) {
            return List.of();
        }
    }
}
