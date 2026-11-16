package com.wbdata.offline.repo.service;

import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.dto.OfflineFlowDocumentResponse;
import com.wbdata.offline.dto.OfflineFlowFileSnapshot;
import com.wbdata.offline.dto.OfflineFlowVersionSnapshotResponse;
import com.wbdata.offline.dto.RollbackOfflineFlowRequest;
import com.wbdata.offline.dto.RollbackOfflineFlowResponse;
import com.wbdata.offline.parameter.dto.FlowParameterBindingItemResponse;
import com.wbdata.offline.parameter.dto.FlowParameterBindingResponse;
import com.wbdata.offline.service.OfflineFlowDocumentService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class OfflineFlowSnapshotService {

    private final OfflineFlowDocumentService flowDocumentService;
    private final GitCommandService gitCommandService;
    private final OfflineProperties offlineProperties;

    public OfflineFlowSnapshotService(OfflineFlowDocumentService flowDocumentService,
                                      GitCommandService gitCommandService,
                                      OfflineProperties offlineProperties) {
        this.flowDocumentService = flowDocumentService;
        this.gitCommandService = gitCommandService;
        this.offlineProperties = offlineProperties;
    }

    public OfflineFlowVersionSnapshotResponse getSnapshot(Long groupId, String path, String revision) {
        SnapshotFileAccess fileAccess = fileAccess(groupId, revision);
        OfflineFlowDocumentService.VersionSnapshotData snapshotData =
                flowDocumentService.getVersionSnapshotData(groupId, path, fileAccess);
        OfflineFlowDocumentResponse document = sanitize(snapshotData.document());
        List<OfflineFlowFileSnapshot> files = snapshotData.managedFiles()
                .stream()
                .map(file -> readFile(groupId, fileAccess, file, false))
                .toList();
        Map<String, OfflineFlowVersionSnapshotResponse.NodeMetadata> nodeMetadata = new LinkedHashMap<>();
        flowDocumentService.extractReferencedParameters(document)
                .forEach((taskId, refs) -> nodeMetadata.put(
                        taskId,
                        new OfflineFlowVersionSnapshotResponse.NodeMetadata(refs)
                ));
        return new OfflineFlowVersionSnapshotResponse(
                revision,
                document,
                files,
                nodeMetadata
        );
    }

    public OfflineFlowFileSnapshot getFile(Long groupId, String path, String revision, String filePath) {
        SnapshotFileAccess fileAccess = fileAccess(groupId, revision);
        List<String> managedFiles = flowDocumentService.resolveManagedFilesAtRevision(groupId, path, fileAccess);
        if (!managedFiles.contains(filePath)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "文件不属于该任务快照");
        }
        return readFile(groupId, fileAccess, filePath, true);
    }

    public RollbackOfflineFlowResponse rollbackFlow(
            RollbackOfflineFlowRequest request,
            OfflineFlowDocumentService.DependencyRollbackValidator dependencyValidator) {
        String revision = request.revision() == null ? null : request.revision().trim();
        if (revision == null || revision.isBlank() || "WORKTREE".equals(revision)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "仅支持回滚到历史提交版本");
        }
        RollbackOfflineFlowRequest normalizedRequest = new RollbackOfflineFlowRequest(
                request.groupId(),
                request.path(),
                revision,
                request.documentHash(),
                request.documentUpdatedAt()
        );
        return flowDocumentService.rollbackFlowDocument(
                normalizedRequest,
                new GitRevisionSnapshotFileAccess(request.groupId(), revision, gitCommandService),
                dependencyValidator
        );
    }

    private SnapshotFileAccess fileAccess(Long groupId, String revision) {
        if ("WORKTREE".equals(revision)) {
            return new WorkingTreeSnapshotFileAccess();
        }
        return new GitRevisionSnapshotFileAccess(groupId, revision, gitCommandService);
    }

    private OfflineFlowFileSnapshot readFile(Long groupId, SnapshotFileAccess fileAccess, String path, boolean includeContent) {
        try {
            String content = fileAccess.readString(offlineProperties.resolveRepoPath(groupId), path);
            byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
            return new OfflineFlowFileSnapshot(path, sha256(bytes), bytes.length, includeContent ? content : null);
        } catch (Exception ex) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "快照文件不存在: " + path, ex);
        }
    }

    private String sha256(byte[] content) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
    }

    private OfflineFlowDocumentResponse sanitize(OfflineFlowDocumentResponse document) {
        return new OfflineFlowDocumentResponse(
                document.groupId(),
                document.path(),
                document.flowId(),
                document.namespace(),
                document.documentHash(),
                document.documentUpdatedAt(),
                document.stages(),
                document.edges(),
                document.layout(),
                document.schedule(),
                sanitizeBinding(document.parameterBinding()),
                document.runtimeTimezone(),
                document.dependencyConfig()
        );
    }

    private FlowParameterBindingResponse sanitizeBinding(FlowParameterBindingResponse binding) {
        if (binding == null) {
            return null;
        }
        List<FlowParameterBindingItemResponse> bindings = binding.bindings() == null ? null : binding.bindings().stream()
                .map(item -> new FlowParameterBindingItemResponse(
                        item.parameterGroupId(), item.code(), item.name(), item.boundVersion(), null, null, item.definitions()))
                .toList();
        return new FlowParameterBindingResponse(
                binding.parameterGroupId(), binding.code(), binding.name(), binding.boundVersion(),
                null, null, binding.definitions(), bindings);
    }
}
