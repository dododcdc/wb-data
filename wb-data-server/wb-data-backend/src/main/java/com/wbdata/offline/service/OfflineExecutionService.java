package com.wbdata.offline.service;

import com.wbdata.offline.config.OfflineKestraProperties;
import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.dto.DebugExecutionRequest;
import com.wbdata.offline.dto.OfflineExecutionDetailResponse;
import com.wbdata.offline.dto.OfflineExecutionListItem;
import com.wbdata.offline.dto.OfflineExecutionLogEntry;
import com.wbdata.offline.dto.OfflineExecutionResponse;
import com.wbdata.offline.dto.OfflineExecutionScriptResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
@RequiredArgsConstructor
public class OfflineExecutionService {

    private final KestraClient kestraClient;
    private final OfflineKestraProperties offlineKestraProperties;
    private final OfflineProperties offlineProperties;
    private final OfflineRepoStatusService offlineRepoStatusService;
    private final OfflineFlowYamlSupport yamlSupport = new OfflineFlowYamlSupport();

    public OfflineExecutionResponse createDebugExecution(DebugExecutionRequest request, Long requestedBy) {
        return createDebugExecution(request, Collections.emptyMap(), requestedBy);
    }

    public OfflineExecutionResponse createDebugExecution(DebugExecutionRequest request,
                                                         Map<String, String> namespaceFileOverrides,
                                                         Long requestedBy) {
        validateSelectedTaskTypes(request);
        String sourceRevision = yamlSupport.sha256Hex(request.content());
        String debugNamespace = offlineKestraProperties.buildDebugNamespace(request.groupId(), requestedBy);
        syncNamespaceFiles(request.groupId(), request.content(), debugNamespace, namespaceFileOverrides);
        OfflineFlowYamlSupport.FlowIdentity identity = yamlSupport.parseIdentity(request.content());
        String debugFlow = yamlSupport.buildDebugFlow(
                request.content(),
                debugNamespace,
                request.flowPath(),
                request.groupId(),
                requestedBy,
                sourceRevision,
                request.mode(),
                request.selectedTaskIds()
        );

        kestraClient.upsertFlow(debugFlow);
        KestraExecutionSnapshot execution = kestraClient.createExecution(debugNamespace, identity.flowId());
        return new OfflineExecutionResponse(
                execution.id(),
                "DEBUG",
                request.flowPath(),
                sourceRevision,
                execution.status(),
                execution.createdAt()
        );
    }

    private void validateSelectedTaskTypes(DebugExecutionRequest request) {
        OfflineFlowYamlSupport.FlowGraph graph = yamlSupport.parseGraph(request.content());
        Set<String> selectedTaskIds = "ALL".equalsIgnoreCase(request.mode())
                ? graph.nodes().stream().map(OfflineFlowYamlSupport.FlowNode::taskId).collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new))
                : new LinkedHashSet<>(request.selectedTaskIds());

        for (OfflineFlowYamlSupport.FlowNode node : graph.nodes()) {
            if (!selectedTaskIds.contains(node.taskId()) || !"SQL".equalsIgnoreCase(node.kind())) {
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

            String taskType = yamlSupport.resolveKestraQueryTaskType(node.dataSourceType());
            if (!kestraClient.supportsTaskType(taskType)) {
                throw new ResponseStatusException(
                        HttpStatus.BAD_REQUEST,
                        "当前 Kestra 未安装 " + node.dataSourceType() + " 执行插件，节点 " + node.taskId() + " 暂时无法执行"
                );
            }
        }
    }

    public List<OfflineExecutionListItem> listExecutions(Long groupId, String flowPath) {
        return listExecutions(groupId, flowPath, null);
    }

    public List<OfflineExecutionListItem> listExecutions(Long groupId, String flowPath, Long requestedBy) {
        return kestraClient.searchExecutions(buildExecutionSearchFilters(groupId, flowPath, requestedBy)).stream()
                .filter(execution -> matchesRequestedBy(execution, requestedBy))
                .sorted(Comparator.comparing(KestraExecutionSnapshot::createdAt).reversed())
                .map(this::toListItem)
                .toList();
    }

    public OfflineExecutionDetailResponse getExecution(Long groupId, String executionId) {
        KestraExecutionSnapshot execution = kestraClient.getExecution(executionId);
        ensureExecutionAccessible(execution, groupId);
        return new OfflineExecutionDetailResponse(
                execution.id(),
                execution.labels().getOrDefault("wbdataMode", "DEBUG"),
                execution.labels().get("wbdataFlowPath"),
                parseRequestedBy(execution),
                readCurrentBranch(groupId),
                execution.labels().get("wbdataSourceRevision"),
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

    public OfflineExecutionScriptResponse getExecutionScript(Long groupId, String executionId) {
        KestraExecutionSnapshot execution = kestraClient.getExecution(executionId);
        ensureExecutionAccessible(execution, groupId);
        return new OfflineExecutionScriptResponse(
                execution.id(),
                execution.labels().get("wbdataFlowPath"),
                kestraClient.getFlowSource(execution.namespace(), execution.flowId())
        );
    }

    public List<OfflineExecutionLogEntry> getExecutionLogs(Long groupId, String executionId, String taskId) {
        ensureExecutionAccessible(kestraClient.getExecution(executionId), groupId);
        return kestraClient.getLogs(executionId, taskId).stream()
                .map(entry -> new OfflineExecutionLogEntry(entry.timestamp(), entry.taskId(), entry.level(), entry.message()))
                .toList();
    }

    public void stopExecution(Long groupId, String executionId) {
        ensureExecutionAccessible(kestraClient.getExecution(executionId), groupId);
        kestraClient.killExecution(executionId);
    }

    public int stopAllExecutions(Long groupId, String flowPath) {
        int stoppedCount = 0;
        for (KestraExecutionSnapshot execution : kestraClient.searchExecutions(buildExecutionSearchFilters(groupId, flowPath, null))) {
            if (isRunning(execution.status())) {
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
                execution.labels().get("wbdataFlowPath"),
                readExecutionDisplayName(execution),
                parseRequestedBy(execution),
                execution.labels().getOrDefault("wbdataMode", "DEBUG"),
                execution.status(),
                "MANUAL",
                execution.startDate(),
                execution.endDate(),
                durationMs,
                execution.labels().get("wbdataSourceRevision")
        );
    }

    private String readExecutionDisplayName(KestraExecutionSnapshot execution) {
        String labeledDisplayName = execution.labels().get("wbdataDisplayName");
        if (labeledDisplayName != null && !labeledDisplayName.isBlank()) {
            return labeledDisplayName;
        }

        String selectedTaskIds = execution.labels().get("wbdataSelectedTaskIds");
        if (selectedTaskIds != null && !selectedTaskIds.isBlank()) {
            String[] values = selectedTaskIds.split(",");
            if (values.length == 1) {
                return values[0];
            }
            if (values.length > 1) {
                return values[0] + " 等 " + values.length + " 个节点";
            }
        }

        if (execution.taskRuns() != null) {
            List<String> taskIds = execution.taskRuns().stream()
                    .map(KestraTaskRunSnapshot::taskId)
                    .filter(taskId -> taskId != null && !taskId.isBlank())
                    .distinct()
                    .toList();
            if (taskIds.size() == 1) {
                return taskIds.get(0);
            }
            if (taskIds.size() > 1) {
                return taskIds.get(0) + " 等 " + taskIds.size() + " 个节点";
            }
        }

        if ("ALL".equalsIgnoreCase(execution.labels().get("wbdataMode"))) {
            return "整个 Flow";
        }
        return execution.id();
    }

    private boolean isRunning(String status) {
        return "RUNNING".equals(status)
                || "CREATED".equals(status)
                || "QUEUED".equals(status)
                || "PAUSED".equals(status);
    }

    private Map<String, String> buildExecutionSearchFilters(Long groupId, String flowPath, Long requestedBy) {
        Map<String, String> filters = new java.util.LinkedHashMap<>();
        if (requestedBy != null) {
            filters.put("filters[namespace][EQUALS]", offlineKestraProperties.buildDebugNamespace(groupId, requestedBy));
        } else {
            filters.put("filters[namespace][CONTAINS]", offlineKestraProperties.buildDebugNamespacePrefix(groupId));
        }
        filters.put("filters[labels][EQUALS][wbdataMode]", "DEBUG");
        filters.put("filters[labels][EQUALS][wbdataFlowPath]", flowPath);
        return filters;
    }

    private void ensureExecutionAccessible(KestraExecutionSnapshot execution, Long groupId) {
        if (!belongsToGroup(execution, groupId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "执行记录不存在");
        }
    }

    private boolean belongsToGroup(KestraExecutionSnapshot execution, Long groupId) {
        String labeledGroupId = execution.labels().get("wbdataGroupId");
        if (labeledGroupId != null && labeledGroupId.equals(String.valueOf(groupId))) {
            return true;
        }
        return execution.namespace() != null
                && execution.namespace().startsWith(offlineKestraProperties.getDebugNamespacePrefix() + groupId + "-u");
    }

    private boolean matchesRequestedBy(KestraExecutionSnapshot execution, Long requestedBy) {
        if (requestedBy == null) {
            return true;
        }
        Long executionRequestedBy = parseRequestedBy(execution);
        return requestedBy.equals(executionRequestedBy);
    }

    private Long parseRequestedBy(KestraExecutionSnapshot execution) {
        String labeledRequestedBy = execution.labels().get("wbdataRequestedBy");
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
        return offlineRepoStatusService.getRepoStatus(groupId).branch();
    }
}
