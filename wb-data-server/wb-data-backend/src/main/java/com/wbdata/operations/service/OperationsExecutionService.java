package com.wbdata.operations.service;

import com.wbdata.git.dto.GitSyncConfigResponse;
import com.wbdata.git.service.GitSyncConfigService;
import com.wbdata.offline.service.KestraClient;
import com.wbdata.offline.service.KestraExecutionSnapshot;
import com.wbdata.offline.service.KestraLogEntry;
import com.wbdata.offline.service.KestraTaskRunSnapshot;
import com.wbdata.operations.dto.OperationsExecutionDetailResponse;
import com.wbdata.operations.dto.OperationsExecutionListItem;
import com.wbdata.operations.dto.OperationsExecutionListResponse;
import com.wbdata.operations.dto.OperationsExecutionLogEntry;
import com.wbdata.operations.dto.OperationsExecutionQuery;
import com.wbdata.operations.dto.OperationsExecutionRerunResponse;
import com.wbdata.operations.dto.OperationsExecutionTaskRun;
import com.wbdata.operations.entity.WbOperationExecutionAction;
import com.wbdata.operations.mapper.WbOperationExecutionActionMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class OperationsExecutionService {

    private final GitSyncConfigService gitSyncConfigService;
    private final KestraClient kestraClient;
    private final WbOperationExecutionActionMapper actionMapper;

    public OperationsExecutionListResponse listExecutions(Long groupId, OperationsExecutionQuery query) {
        OperationsExecutionQuery effectiveQuery = query == null
                ? new OperationsExecutionQuery(null, null, null, null, null)
                : query;
        if (effectiveQuery.from() != null && effectiveQuery.to() != null && effectiveQuery.from().isAfter(effectiveQuery.to())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "时间范围不合法");
        }
        Instant to = effectiveQuery.to() == null ? Instant.now() : effectiveQuery.to();
        Instant from = effectiveQuery.from() == null ? to.minus(Duration.ofHours(24)) : effectiveQuery.from();
        LinkedHashMap<String, String> namespaceToBranch = scopedNamespaces(groupId);
        List<String> targetNamespaces = targetNamespaces(namespaceToBranch, blankToNull(effectiveQuery.branch()));

        List<OperationsExecutionListItem> executions = new ArrayList<>();
        for (String namespace : targetNamespaces) {
            List<KestraExecutionSnapshot> snapshots = kestraClient.searchExecutions(buildExecutionSearchFilters(namespace, from, to));
            if (snapshots == null) {
                continue;
            }
            for (KestraExecutionSnapshot execution : snapshots) {
                if (!isBusinessExecution(execution, namespaceToBranch)) {
                    continue;
                }
                String branch = namespaceToBranch.get(execution.namespace());
                if (!matchesFilters(execution, branch, effectiveQuery, from, to)) {
                    continue;
                }
                executions.add(toListItem(execution, branch));
            }
        }

        executions.sort(this::compareByExecutionTimeDescending);

        return new OperationsExecutionListResponse(
                namespaceToBranch.values().stream().toList(),
                blankToNull(effectiveQuery.branch()),
                from,
                to,
                executions
        );
    }

    public OperationsExecutionDetailResponse getExecution(Long groupId, String executionId) {
        Scope scope = loadScope(groupId);
        KestraExecutionSnapshot execution = requireAccessibleExecution(scope, executionId);
        return toDetail(execution, scope.branchFor(execution.namespace()));
    }

    public List<OperationsExecutionLogEntry> getLogs(Long groupId, String executionId, String taskId) {
        Scope scope = loadScope(groupId);
        requireAccessibleExecution(scope, executionId);
        List<KestraLogEntry> logs = kestraClient.getLogs(executionId, blankToNull(taskId));
        if (logs == null) {
            return List.of();
        }
        return logs.stream()
                .filter(log -> log != null)
                .map(this::toLogEntry)
                .toList();
    }

    public OperationsExecutionRerunResponse rerunExecution(Long groupId, Long requestedBy, String executionId) {
        Scope scope = loadScope(groupId);
        KestraExecutionSnapshot original = requireAccessibleExecution(scope, executionId);
        if (!rerunnable(original.status())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "当前状态不支持重跑");
        }

        KestraExecutionSnapshot rerun = kestraClient.createExecution(original.namespace(), original.flowId());

        WbOperationExecutionAction action = new WbOperationExecutionAction();
        action.setGroupId(groupId);
        action.setActionType("RERUN");
        action.setOriginalExecutionId(original.id());
        action.setNewExecutionId(rerun.id());
        action.setNamespace(original.namespace());
        action.setFlowId(original.flowId());
        action.setRequestedBy(requestedBy);
        action.setRequestedAt(LocalDateTime.now());
        insertAuditOrStopExecution(action, rerun.id());

        return new OperationsExecutionRerunResponse(
                original.id(),
                rerun.id(),
                rerun.namespace(),
                rerun.flowId(),
                rerun.status(),
                rerun.createdAt()
        );
    }

    private void insertAuditOrStopExecution(WbOperationExecutionAction action, String createdExecutionId) {
        try {
            int affectedRows = actionMapper.insert(action);
            if (affectedRows != 1) {
                throw new IllegalStateException("审计记录未写入");
            }
        } catch (RuntimeException ex) {
            stopCreatedExecutionAfterAuditFailure(createdExecutionId, ex);
        }
    }

    private void stopCreatedExecutionAfterAuditFailure(String createdExecutionId, RuntimeException ex) {
        try {
            kestraClient.killExecution(createdExecutionId);
        } catch (RuntimeException killException) {
            ex.addSuppressed(killException);
        }
        throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "重跑审计记录写入失败，已尝试停止新执行", ex);
    }

    private Scope loadScope(Long groupId) {
        return new Scope(scopedNamespaces(groupId));
    }

    private KestraExecutionSnapshot requireAccessibleExecution(Scope scope, String executionId) {
        KestraExecutionSnapshot execution = kestraClient.getExecution(executionId);
        if (!isBusinessExecution(execution, scope.namespaceToBranch())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "执行记录不存在");
        }
        return execution;
    }

    private LinkedHashMap<String, String> scopedNamespaces(Long groupId) {
        LinkedHashMap<String, String> namespaceToBranch = new LinkedHashMap<>();
        List<GitSyncConfigResponse> configs = gitSyncConfigService.listEnabledSyncConfigs(groupId);
        if (configs == null) {
            return namespaceToBranch;
        }
        for (GitSyncConfigResponse config : configs) {
            if (config == null || isBlank(config.namespace()) || isBlank(config.branch())) {
                continue;
            }
            namespaceToBranch.put(config.namespace(), config.branch());
        }
        return namespaceToBranch;
    }

    private List<String> targetNamespaces(LinkedHashMap<String, String> namespaceToBranch, String branchFilter) {
        if (branchFilter == null) {
            return namespaceToBranch.keySet().stream().toList();
        }
        return namespaceToBranch.entrySet().stream()
                .filter(entry -> branchFilter.equals(entry.getValue()))
                .map(Map.Entry::getKey)
                .toList();
    }

    private Map<String, String> buildExecutionSearchFilters(String namespace, Instant from, Instant to) {
        Map<String, String> filters = new LinkedHashMap<>();
        filters.put("filters[namespace][EQUALS]", namespace);
        filters.put("startDate", toKestraSearchInstant(from));
        filters.put("endDate", toKestraSearchInstant(to));
        return filters;
    }

    private String toKestraSearchInstant(Instant instant) {
        return DateTimeFormatter.ISO_INSTANT.format(instant.truncatedTo(ChronoUnit.MILLIS));
    }

    private boolean isBusinessExecution(KestraExecutionSnapshot execution, Map<String, String> namespaceToBranch) {
        if (execution == null || execution.namespace() == null || execution.flowId() == null) {
            return false;
        }
        if (!namespaceToBranch.containsKey(execution.namespace())) {
            return false;
        }
        if ("system".equals(execution.namespace())) {
            return false;
        }
        if (execution.namespace().startsWith("wb-debug-")) {
            return false;
        }
        return !execution.flowId().startsWith("sync-flows-");
    }

    private boolean matchesFilters(KestraExecutionSnapshot execution,
                                   String branch,
                                   OperationsExecutionQuery query,
                                   Instant from,
                                   Instant to) {
        String branchFilter = blankToNull(query.branch());
        if (branchFilter != null && !branchFilter.equals(branch)) {
            return false;
        }
        String flowFilter = blankToNull(query.flowId());
        if (flowFilter != null && !containsIgnoreCase(execution.flowId(), flowFilter)) {
            return false;
        }
        String statusFilter = blankToNull(query.status());
        if (statusFilter != null && (execution.status() == null || !execution.status().equalsIgnoreCase(statusFilter))) {
            return false;
        }
        Instant executionTime = execution.createdAt() == null ? execution.startDate() : execution.createdAt();
        return executionTime != null && !executionTime.isBefore(from) && !executionTime.isAfter(to);
    }

    private OperationsExecutionListItem toListItem(KestraExecutionSnapshot execution, String branch) {
        return new OperationsExecutionListItem(
                execution.id(),
                execution.namespace(),
                execution.flowId(),
                branch,
                execution.status(),
                execution.createdAt(),
                execution.startDate(),
                execution.endDate(),
                durationMs(execution.startDate(), execution.endDate()),
                rerunnable(execution.status())
        );
    }

    private OperationsExecutionDetailResponse toDetail(KestraExecutionSnapshot execution, String branch) {
        List<OperationsExecutionTaskRun> taskRuns = execution.taskRuns() == null
                ? List.of()
                : execution.taskRuns().stream()
                .filter(taskRun -> taskRun != null)
                .map(this::toTaskRun)
                .toList();
        return new OperationsExecutionDetailResponse(
                execution.id(),
                execution.namespace(),
                execution.flowId(),
                branch,
                execution.status(),
                execution.createdAt(),
                execution.startDate(),
                execution.endDate(),
                durationMs(execution.startDate(), execution.endDate()),
                rerunnable(execution.status()),
                taskRuns,
                execution.inputs() == null ? Map.of() : execution.inputs(),
                execution.labels() == null ? Map.of() : execution.labels()
        );
    }

    private OperationsExecutionTaskRun toTaskRun(KestraTaskRunSnapshot taskRun) {
        return new OperationsExecutionTaskRun(
                taskRun.taskId(),
                taskRun.status(),
                taskRun.startDate(),
                taskRun.endDate(),
                durationMs(taskRun.startDate(), taskRun.endDate())
        );
    }

    private OperationsExecutionLogEntry toLogEntry(KestraLogEntry log) {
        return new OperationsExecutionLogEntry(
                log.timestamp(),
                log.taskId(),
                log.level(),
                log.message()
        );
    }

    private Long durationMs(Instant startDate, Instant endDate) {
        if (startDate == null || endDate == null) {
            return null;
        }
        return endDate.toEpochMilli() - startDate.toEpochMilli();
    }

    private int compareByExecutionTimeDescending(OperationsExecutionListItem left, OperationsExecutionListItem right) {
        Instant leftTime = executionTime(left);
        Instant rightTime = executionTime(right);
        if (leftTime == null && rightTime == null) {
            return 0;
        }
        if (leftTime == null) {
            return 1;
        }
        if (rightTime == null) {
            return -1;
        }
        return rightTime.compareTo(leftTime);
    }

    private Instant executionTime(OperationsExecutionListItem item) {
        return item.createdAt() == null ? item.startDate() : item.createdAt();
    }

    private boolean rerunnable(String status) {
        if (status == null) {
            return false;
        }
        String normalized = status.toUpperCase(Locale.ROOT);
        return "FAILED".equals(normalized) || "CANCELLED".equals(normalized) || "KILLED".equals(normalized);
    }

    private boolean containsIgnoreCase(String value, String expected) {
        return value.toLowerCase(Locale.ROOT).contains(expected.toLowerCase(Locale.ROOT));
    }

    private String blankToNull(String value) {
        return isBlank(value) ? null : value.trim();
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private record Scope(LinkedHashMap<String, String> namespaceToBranch) {
        private String branchFor(String namespace) {
            return namespaceToBranch.get(namespace);
        }
    }
}
