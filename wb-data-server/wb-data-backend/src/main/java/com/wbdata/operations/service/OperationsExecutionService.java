package com.wbdata.operations.service;

import com.wbdata.git.dto.GitSyncConfigResponse;
import com.wbdata.git.service.GitSyncConfigService;
import com.wbdata.offline.service.KestraClient;
import com.wbdata.offline.service.KestraExecutionSnapshot;
import com.wbdata.offline.service.KestraTaskRunSnapshot;
import com.wbdata.operations.dto.OperationsExecutionListItem;
import com.wbdata.operations.dto.OperationsExecutionListResponse;
import com.wbdata.operations.dto.OperationsExecutionQuery;
import com.wbdata.operations.mapper.WbOperationExecutionActionMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
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
        filters.put("startDate", from.toString());
        filters.put("endDate", to.toString());
        return filters;
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
        Long durationMs = null;
        if (execution.startDate() != null && execution.endDate() != null) {
            durationMs = execution.endDate().toEpochMilli() - execution.startDate().toEpochMilli();
        }
        return new OperationsExecutionListItem(
                execution.id(),
                execution.namespace(),
                execution.flowId(),
                branch,
                execution.status(),
                execution.createdAt(),
                execution.startDate(),
                execution.endDate(),
                durationMs,
                failureSummary(execution),
                rerunnable(execution.status())
        );
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

    private String failureSummary(KestraExecutionSnapshot execution) {
        if (execution.status() == null || !"FAILED".equalsIgnoreCase(execution.status()) || execution.taskRuns() == null) {
            return null;
        }
        for (KestraTaskRunSnapshot taskRun : execution.taskRuns()) {
            if (taskRun != null
                    && taskRun.taskId() != null
                    && taskRun.status() != null
                    && "FAILED".equalsIgnoreCase(taskRun.status())) {
                return taskRun.taskId() + " failed";
            }
        }
        return null;
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
}
