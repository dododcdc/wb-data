package com.wbdata.offline.service;

import com.wbdata.offline.config.OfflineKestraProperties;
import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.dto.DebugExecutionRequest;
import com.wbdata.offline.dto.OfflineExecutionDetailResponse;
import com.wbdata.offline.dto.OfflineExecutionListItem;
import com.wbdata.offline.dto.OfflineExecutionLogEntry;
import com.wbdata.offline.dto.OfflineExecutionResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
@RequiredArgsConstructor
public class OfflineExecutionService {

    private final KestraClient kestraClient;
    private final OfflineKestraProperties offlineKestraProperties;
    private final OfflineProperties offlineProperties;
    private final OfflineFlowYamlSupport yamlSupport = new OfflineFlowYamlSupport();
    private final Map<String, DebugExecutionRef> executionRefs = new ConcurrentHashMap<>();

    public OfflineExecutionResponse createDebugExecution(DebugExecutionRequest request, Long requestedBy) {
        String sourceRevision = yamlSupport.sha256Hex(request.content());
        String debugNamespace = offlineKestraProperties.buildDebugNamespace(request.groupId(), requestedBy);
        syncNamespaceFiles(request.groupId(), request.content(), debugNamespace);
        OfflineFlowYamlSupport.FlowIdentity identity = yamlSupport.parseIdentity(request.content());
        String debugFlow = yamlSupport.buildDebugFlow(
                request.content(),
                debugNamespace,
                request.flowPath(),
                sourceRevision,
                request.mode(),
                request.selectedTaskIds()
        );

        kestraClient.upsertFlow(debugFlow);
        KestraExecutionSnapshot execution = kestraClient.createExecution(debugNamespace, identity.flowId());
        executionRefs.put(execution.id(), new DebugExecutionRef(
                execution.id(),
                request.groupId(),
                request.flowPath(),
                "DEBUG",
                sourceRevision,
                requestedBy,
                debugNamespace,
                identity.flowId(),
                execution.createdAt()
        ));
        return new OfflineExecutionResponse(
                execution.id(),
                "DEBUG",
                request.flowPath(),
                sourceRevision,
                execution.status(),
                execution.createdAt()
        );
    }

    public List<OfflineExecutionListItem> listExecutions(Long groupId, String flowPath) {
        return executionRefs.values().stream()
                .filter(ref -> ref.groupId().equals(groupId) && ref.flowPath().equals(flowPath))
                .sorted(Comparator.comparing(DebugExecutionRef::createdAt).reversed())
                .map(ref -> toListItem(ref, kestraClient.getExecution(ref.executionId())))
                .toList();
    }

    public OfflineExecutionDetailResponse getExecution(Long groupId, String executionId) {
        DebugExecutionRef ref = requireExecutionRef(groupId, executionId);
        KestraExecutionSnapshot execution = kestraClient.getExecution(executionId);
        return new OfflineExecutionDetailResponse(
                execution.id(),
                ref.mode(),
                ref.flowPath(),
                ref.sourceRevision(),
                execution.status(),
                execution.createdAt(),
                execution.startDate(),
                execution.endDate(),
                execution.taskRuns().stream()
                        .map(taskRun -> new com.wbdata.offline.dto.OfflineExecutionTaskRun(
                                taskRun.taskId(),
                                taskRun.status(),
                                taskRun.startDate(),
                                taskRun.endDate()
                        ))
                        .toList()
        );
    }

    public List<OfflineExecutionLogEntry> getExecutionLogs(Long groupId, String executionId, String taskId) {
        requireExecutionRef(groupId, executionId);
        return kestraClient.getLogs(executionId, taskId).stream()
                .map(entry -> new OfflineExecutionLogEntry(entry.timestamp(), entry.taskId(), entry.level(), entry.message()))
                .toList();
    }

    public void stopExecution(Long groupId, String executionId) {
        requireExecutionRef(groupId, executionId);
        kestraClient.killExecution(executionId);
    }

    public int stopAllExecutions(Long groupId, String flowPath) {
        int stoppedCount = 0;
        for (DebugExecutionRef ref : executionRefs.values()) {
            if (!ref.groupId().equals(groupId) || !ref.flowPath().equals(flowPath)) {
                continue;
            }
            KestraExecutionSnapshot execution = kestraClient.getExecution(ref.executionId());
            if (isRunning(execution.status())) {
                kestraClient.killExecution(ref.executionId());
                stoppedCount++;
            }
        }
        return stoppedCount;
    }

    private void syncNamespaceFiles(Long groupId, String source, String debugNamespace) {
        List<String> namespaceFiles = yamlSupport.collectNamespaceFiles(source);
        if (namespaceFiles.isEmpty()) {
            return;
        }

        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        for (String file : namespaceFiles) {
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

    private OfflineExecutionListItem toListItem(DebugExecutionRef ref, KestraExecutionSnapshot execution) {
        Long durationMs = null;
        if (execution.startDate() != null && execution.endDate() != null) {
            durationMs = execution.endDate().toEpochMilli() - execution.startDate().toEpochMilli();
        }
        return new OfflineExecutionListItem(
                execution.id(),
                ref.flowPath(),
                ref.mode(),
                execution.status(),
                "MANUAL",
                execution.startDate(),
                execution.endDate(),
                durationMs,
                ref.sourceRevision()
        );
    }

    private boolean isRunning(String status) {
        return "RUNNING".equals(status)
                || "CREATED".equals(status)
                || "QUEUED".equals(status)
                || "PAUSED".equals(status);
    }

    private DebugExecutionRef requireExecutionRef(Long groupId, String executionId) {
        DebugExecutionRef ref = executionRefs.get(executionId);
        if (ref == null || !ref.groupId().equals(groupId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "执行记录不存在");
        }
        return ref;
    }

    private record DebugExecutionRef(
            String executionId,
            Long groupId,
            String flowPath,
            String mode,
            String sourceRevision,
            Long requestedBy,
            String debugNamespace,
            String debugFlowId,
            Instant createdAt
    ) {
    }
}
