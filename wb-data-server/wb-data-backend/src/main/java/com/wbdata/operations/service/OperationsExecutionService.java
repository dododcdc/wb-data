package com.wbdata.operations.service;

import com.wbdata.git.dto.GitSyncConfigResponse;
import com.wbdata.git.service.GitSyncConfigService;
import com.wbdata.offline.service.KestraClient;
import com.wbdata.offline.service.KestraExecutionSnapshot;
import com.wbdata.offline.service.KestraLogEntry;
import com.wbdata.offline.service.KestraTaskRunSnapshot;
import com.wbdata.offline.service.ExecutionParameterResolver;
import com.wbdata.offline.service.ExecutionParameterSnapshotRegistry;
import com.wbdata.offline.service.ExecutionTimeContext;
import com.wbdata.offline.service.FlowParameterMetadata;
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
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.LinkedHashSet;

@Service
@RequiredArgsConstructor
public class OperationsExecutionService {

    private static final int DEFAULT_PAGE = 1;
    private static final int DEFAULT_PAGE_SIZE = 50;
    private static final int MAX_PAGE_SIZE = 200;
    private static final String PARAMETER_OVERRIDE_KEYS_LABEL = "wbdataParameterOverrideKeys";
    private static final String NO_PARAMETER_OVERRIDES_LABEL_VALUE = "__none__";

    private final GitSyncConfigService gitSyncConfigService;
    private final KestraClient kestraClient;
    private final WbOperationExecutionActionMapper actionMapper;
    private final ExecutionParameterSnapshotRegistry parameterSnapshotRegistry;
    private final ExecutionParameterResolver parameterResolver = new ExecutionParameterResolver();

    public OperationsExecutionListResponse listExecutions(Long groupId, OperationsExecutionQuery query) {
        OperationsExecutionQuery effectiveQuery = query == null
                ? new OperationsExecutionQuery(null, null, null, null, null, null, null)
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
        int total = executions.size();
        int pageSize = normalizePageSize(effectiveQuery.pageSize());
        int totalPages = total == 0 ? 0 : (int) Math.ceil((double) total / pageSize);
        int page = normalizePage(effectiveQuery.page(), totalPages);
        List<OperationsExecutionListItem> pageExecutions = executions.stream()
                .skip((long) (page - 1) * pageSize)
                .limit(pageSize)
                .toList();

        return new OperationsExecutionListResponse(
                namespaceToBranch.values().stream().toList(),
                blankToNull(effectiveQuery.branch()),
                from,
                to,
                page,
                pageSize,
                total,
                totalPages,
                pageExecutions
        );
    }

    public OperationsExecutionDetailResponse getExecution(Long groupId, String executionId) {
        Scope scope = loadScope(groupId);
        KestraExecutionSnapshot execution = requireAccessibleExecution(scope, executionId);
        return toDetail(groupId, execution, scope.branchFor(execution.namespace()));
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

    public OperationsExecutionRerunResponse rerunExecution(Long groupId,
                                                            Long requestedBy,
                                                            String executionId,
                                                            boolean reuseManualOverrides) {
        Scope scope = loadScope(groupId);
        KestraExecutionSnapshot original = requireAccessibleExecution(scope, executionId);
        if (!rerunnable(original.status())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "当前状态不支持重跑");
        }

        Map<String, String> rerunInputs = resolveRerunInputs(groupId, original, reuseManualOverrides);
        Set<String> originalOverrideKeys = splitLabelValues(labels(original).get(PARAMETER_OVERRIDE_KEYS_LABEL));
        String rerunOverrideKeys = reuseManualOverrides && !originalOverrideKeys.isEmpty()
                ? String.join("---", originalOverrideKeys)
                : NO_PARAMETER_OVERRIDES_LABEL_VALUE;
        KestraExecutionSnapshot rerun = kestraClient.createExecution(
                original.namespace(),
                original.flowId(),
                rerunInputs,
                Map.of(PARAMETER_OVERRIDE_KEYS_LABEL, rerunOverrideKeys));

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

    private Map<String, String> resolveRerunInputs(Long groupId,
                                                   KestraExecutionSnapshot original,
                                                   boolean reuseManualOverrides) {
        Map<String, String> rerunInputs = new LinkedHashMap<>();
        Map<String, String> originalInputs = original.inputs() == null ? Map.of() : original.inputs();
        Set<String> originalOverrideKeys = splitLabelValues(labels(original).get(PARAMETER_OVERRIDE_KEYS_LABEL));
        String currentSnapshotId = FlowParameterMetadata.readSnapshotId(
                kestraClient.getFlowSource(original.namespace(), original.flowId()));
        com.wbdata.offline.dto.FlowParameterSnapshot currentSnapshot =
                currentSnapshotId == null || currentSnapshotId.isBlank()
                        ? null
                        : parameterSnapshotRegistry.find(groupId, currentSnapshotId)
                        .orElseThrow(() -> new ResponseStatusException(
                                HttpStatus.BAD_REQUEST, "当前 Flow 的参数快照已不可用，无法重跑"));
        if (reuseManualOverrides && !originalOverrideKeys.isEmpty()) {
            if (currentSnapshot == null) {
                throw new ResponseStatusException(
                        HttpStatus.BAD_REQUEST, "当前 Flow 没有参数定义，无法沿用原执行的手动覆盖值");
            }
            for (String overrideKey : originalOverrideKeys) {
                String value = originalInputs.get(overrideKey);
                if (value == null) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "原执行的手动参数值不完整，无法重跑");
                }
                if (!definesParameter(currentSnapshot, overrideKey)) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                            "参数 " + overrideKey + " 在当前 Flow 参数中已不存在，无法沿用覆盖值重跑");
                }
                rerunInputs.put(overrideKey, value);
            }
        }
        if (currentSnapshot != null && hasPlannedTimeParameter(currentSnapshot)) {
            Instant plannedTime = readPlannedTime(original);
            if (plannedTime == null) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "原执行缺少计划时间，无法重跑");
            }
            rerunInputs.put(ExecutionTimeContext.PLANNED_TIME_INPUT, plannedTime.toString());
        }
        return Map.copyOf(rerunInputs);
    }

    private boolean definesParameter(com.wbdata.offline.dto.FlowParameterSnapshot snapshot, String key) {
        return snapshot.definitions().stream().anyMatch(definition -> key.equals(definition.key()));
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
                readPlannedTime(execution),
                execution.createdAt(),
                execution.startDate(),
                execution.endDate(),
                durationMs(execution.startDate(), execution.endDate()),
                rerunnable(execution.status())
        );
    }

    private OperationsExecutionDetailResponse toDetail(Long groupId,
                                                        KestraExecutionSnapshot execution,
                                                        String branch) {
        List<OperationsExecutionTaskRun> taskRuns = execution.taskRuns() == null
                ? List.of()
                : execution.taskRuns().stream()
                .filter(taskRun -> taskRun != null)
                .filter(this::isUserTaskRun)
                .map(this::toTaskRun)
                .toList();
        ParameterDetail parameterDetail = resolveParameterDetail(groupId, execution);
        return new OperationsExecutionDetailResponse(
                execution.id(),
                execution.namespace(),
                execution.flowId(),
                branch,
                execution.status(),
                readPlannedTime(execution),
                execution.createdAt(),
                execution.startDate(),
                execution.endDate(),
                durationMs(execution.startDate(), execution.endDate()),
                rerunnable(execution.status()),
                taskRuns,
                execution.inputs() == null ? Map.of() : execution.inputs(),
                execution.labels() == null ? Map.of() : execution.labels(),
                parameterDetail.status(),
                parameterDetail.parameters(),
                resolveParameterSnapshotChanged(execution)
        );
    }

    private Boolean resolveParameterSnapshotChanged(KestraExecutionSnapshot execution) {
        String originalSnapshotId = labels(execution).get(ExecutionParameterSnapshotRegistry.LABEL_KEY);
        String currentSnapshotId;
        try {
            currentSnapshotId = FlowParameterMetadata.readSnapshotId(
                    kestraClient.getFlowSource(execution.namespace(), execution.flowId()));
        } catch (RuntimeException ex) {
            return null;
        }
        boolean originalHas = originalSnapshotId != null && !originalSnapshotId.isBlank();
        boolean currentHas = currentSnapshotId != null && !currentSnapshotId.isBlank();
        if (originalHas != currentHas) {
            return Boolean.TRUE;
        }
        return originalHas && !originalSnapshotId.equals(currentSnapshotId);
    }

    private ParameterDetail resolveParameterDetail(Long groupId, KestraExecutionSnapshot execution) {
        String snapshotId = labels(execution).get(ExecutionParameterSnapshotRegistry.LABEL_KEY);
        if (snapshotId == null || snapshotId.isBlank()) {
            String status = execution.inputs() == null || execution.inputs().isEmpty() ? "NONE" : "UNAVAILABLE";
            return new ParameterDetail(status, List.of());
        }
        var snapshot = parameterSnapshotRegistry.find(groupId, snapshotId).orElse(null);
        if (snapshot == null) {
            return new ParameterDetail("UNAVAILABLE", List.of());
        }
        var resolution = parameterResolver.resolveExecution(
                snapshot,
                execution.inputs(),
                new ExecutionTimeContext(readPlannedTime(execution), execution.startDate()),
                splitLabelValues(labels(execution).get(PARAMETER_OVERRIDE_KEYS_LABEL))
        );
        return new ParameterDetail(resolution.status(), resolution.parameters());
    }

    private boolean hasPlannedTimeParameter(com.wbdata.offline.dto.FlowParameterSnapshot snapshot) {
        return snapshot.definitions().stream()
                .anyMatch(definition -> "SYSTEM_TIME".equals(definition.valueSource())
                        && "PLANNED_TIME".equals(
                        definition.timeBasis() == null ? "PLANNED_TIME" : definition.timeBasis()));
    }

    private Instant readPlannedTime(KestraExecutionSnapshot execution) {
        String input = execution.inputs() == null
                ? null
                : execution.inputs().get(ExecutionTimeContext.PLANNED_TIME_INPUT);
        if (input == null || input.isBlank()) {
            return execution.plannedAt();
        }
        try {
            return Instant.parse(input);
        } catch (DateTimeParseException ex) {
            return null;
        }
    }

    private Set<String> splitLabelValues(String value) {
        if (value == null || value.isBlank()) {
            return Set.of();
        }
        return java.util.Arrays.stream(value.split("---"))
                .map(String::trim)
                .filter(item -> !item.isEmpty() && !NO_PARAMETER_OVERRIDES_LABEL_VALUE.equals(item))
                .collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new));
    }

    private Map<String, String> labels(KestraExecutionSnapshot execution) {
        return execution.labels() == null ? Map.of() : execution.labels();
    }

    private record ParameterDetail(
            String status,
            List<com.wbdata.offline.dto.ExecutionParameterValueResponse> parameters
    ) {
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

    private boolean isUserTaskRun(KestraTaskRunSnapshot taskRun) {
        String taskId = taskRun.taskId();
        return taskId != null && !"flow_dag".equals(taskId) && !taskId.startsWith("parallel_");
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

    private int normalizePage(Integer requestedPage, int totalPages) {
        int page = requestedPage == null || requestedPage < DEFAULT_PAGE ? DEFAULT_PAGE : requestedPage;
        if (totalPages == 0) {
            return DEFAULT_PAGE;
        }
        return Math.min(page, totalPages);
    }

    private int normalizePageSize(Integer requestedPageSize) {
        if (requestedPageSize == null || requestedPageSize < 1) {
            return DEFAULT_PAGE_SIZE;
        }
        return Math.min(requestedPageSize, MAX_PAGE_SIZE);
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
