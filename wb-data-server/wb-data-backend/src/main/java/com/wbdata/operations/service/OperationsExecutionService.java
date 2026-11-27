package com.wbdata.operations.service;

import com.wbdata.offline.parameter.dto.ExecutionParameterValueResponse;
import com.wbdata.offline.parameter.dto.FlowParameterSnapshot;

import com.wbdata.git.dto.GitSyncConfigResponse;
import com.wbdata.git.service.GitSyncConfigService;
import com.wbdata.group.dto.GroupOwnerInfo;
import com.wbdata.group.service.GroupOwnerService;
import com.wbdata.offline.entity.WbOfflineFlowIndex;
import com.wbdata.offline.kestra.KestraClient;
import com.wbdata.offline.kestra.KestraExecutionPage;
import com.wbdata.offline.kestra.KestraExecutionSnapshot;
import com.wbdata.offline.kestra.KestraLogEntry;
import com.wbdata.offline.kestra.KestraTaskRunSnapshot;
import com.wbdata.offline.parameter.service.ExecutionParameterResolver;
import com.wbdata.offline.parameter.service.ExecutionParameterSnapshotRegistry;
import com.wbdata.offline.parameter.service.ExecutionTimeContext;
import com.wbdata.offline.parameter.service.FlowParameterMetadata;
import com.wbdata.offline.execution.dto.ExecutionLogEntry;
import com.wbdata.offline.execution.dto.ExecutionTaskRun;
import com.wbdata.offline.service.OfflineFlowIndexService;
import com.wbdata.offline.service.OfflineFlowInspector;
import com.wbdata.operations.dto.OperationsExecutionDetailResponse;
import com.wbdata.operations.dto.OperationsExecutionListItem;
import com.wbdata.operations.dto.OperationsExecutionListResponse;
import com.wbdata.operations.dto.OperationsExecutionQuery;
import com.wbdata.operations.dto.OperationsExecutionRerunContextResponse;
import com.wbdata.operations.dto.OperationsExecutionRerunResponse;
import com.wbdata.operations.dto.OperationsExecutionStatusCounts;
import com.wbdata.operations.entity.WbOperationExecutionAction;
import com.wbdata.operations.mapper.WbOperationExecutionActionMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.lang.Nullable;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

@Slf4j
@Service
@RequiredArgsConstructor
public class OperationsExecutionService {

    private static final int DEFAULT_PAGE = 1;
    private static final int DEFAULT_PAGE_SIZE = 50;
    private static final int MAX_PAGE_SIZE = 200;
    private static final String SORT_START_DATE_DESC = "state.startDate:desc";
    private static final String ACTIVE_STATES_PARAM = "CREATED,QUEUED,RUNNING,PAUSED,RETRYING";
    private static final String STOPPED_STATES_PARAM = "KILLED,CANCELLED";
    private static final String REGEX_META_CHARS = "\\.^$*+?()[]{}|";
    private static final Set<String> KNOWN_KESTRA_STATES = Set.of(
            "CREATED", "RUNNING", "PAUSED", "RESTARTED", "KILLING",
            "SUCCESS", "WARNING", "FAILED", "KILLED", "CANCELLED",
            "QUEUED", "RETRYING", "RETRIED", "SKIPPED", "BREAKPOINT"
    );
    private static final String PARAMETER_OVERRIDE_KEYS_LABEL = "wbdataParameterOverrideKeys";
    private static final String NO_PARAMETER_OVERRIDES_LABEL_VALUE = "__none__";
    private static final Set<String> SYSTEM_INPUT_KEYS = Set.of(
            ExecutionTimeContext.PLANNED_TIME_INPUT,
            "wbdata_bypass_gate",
            OfflineFlowInspector.RERUN_TASKS_INPUT
    );

    private final GitSyncConfigService gitSyncConfigService;
    private final KestraClient kestraClient;
    private final WbOperationExecutionActionMapper actionMapper;
    private final ExecutionParameterSnapshotRegistry parameterSnapshotRegistry;
    private final ExecutionParameterResolver parameterResolver = new ExecutionParameterResolver();
    private final OfflineFlowInspector flowInspector = new OfflineFlowInspector();
    @Nullable
    private OfflineFlowIndexService offlineFlowIndexService;
    @Nullable
    private GroupOwnerService groupOwnerService;

    @Autowired(required = false)
    public void setOfflineFlowIndexService(@Nullable OfflineFlowIndexService offlineFlowIndexService) {
        this.offlineFlowIndexService = offlineFlowIndexService;
    }

    @Autowired(required = false)
    public void setGroupOwnerService(@Nullable GroupOwnerService groupOwnerService) {
        this.groupOwnerService = groupOwnerService;
    }

    public OperationsExecutionListResponse listExecutions(Long groupId, OperationsExecutionQuery query) {
        OperationsExecutionQuery effectiveQuery = query == null
                ? new OperationsExecutionQuery(null, null, null, null, null, null, null, null)
                : query;
        if (effectiveQuery.from() != null && effectiveQuery.to() != null && effectiveQuery.from().isAfter(effectiveQuery.to())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "时间范围不合法");
        }
        Instant to = effectiveQuery.to() == null ? Instant.now() : effectiveQuery.to();
        Instant from = effectiveQuery.from() == null ? to.minus(Duration.ofHours(24)) : effectiveQuery.from();
        LinkedHashMap<String, String> namespaceToBranch = scopedNamespaces(groupId);
        List<String> targetNamespaces = targetNamespaces(namespaceToBranch, blankToNull(effectiveQuery.branch()))
                .stream()
                .filter(this::isBusinessNamespace)
                .toList();
        int pageSize = normalizePageSize(effectiveQuery.pageSize());
        if (targetNamespaces.isEmpty()) {
            return new OperationsExecutionListResponse(
                    namespaceToBranch.values().stream().toList(),
                    blankToNull(effectiveQuery.branch()),
                    from,
                    to,
                    DEFAULT_PAGE,
                    pageSize,
                    0,
                    0,
                    List.of(),
                    new OperationsExecutionStatusCounts(0, 0, 0, 0, 0)
            );
        }

        int requestedPage = effectiveQuery.page() == null || effectiveQuery.page() < DEFAULT_PAGE
                ? DEFAULT_PAGE
                : effectiveQuery.page();
        String flowFilter = blankToNull(effectiveQuery.flowId());
        List<String> ownedFlowIds = resolveOwnedFlowIdsForFilter(groupId, effectiveQuery.ownerUserId(), flowFilter);
        if (ownedFlowIds != null && ownedFlowIds.isEmpty()) {
            return new OperationsExecutionListResponse(
                    namespaceToBranch.values().stream().toList(),
                    blankToNull(effectiveQuery.branch()),
                    from,
                    to,
                    DEFAULT_PAGE,
                    pageSize,
                    0,
                    0,
                    List.of(),
                    new OperationsExecutionStatusCounts(0, 0, 0, 0, 0)
            );
        }
        String statusRaw = blankToNull(effectiveQuery.status());
        String normalizedStatus = statusRaw == null ? null : statusRaw.toUpperCase(Locale.ROOT);
        Map<String, String> baseFilters = buildBaseSearchFilters(targetNamespaces, from, to, flowFilter, ownedFlowIds);
        Optional<Map<String, String>> pageFiltersOpt = buildStatusFilters(baseFilters, normalizedStatus);

        KestraExecutionPage mainPage;
        Long fetchedTotalCount;
        Long fetchedSuccessCount;
        Long fetchedFailedCount;
        Long fetchedActiveCount;
        Long fetchedStoppedCount;
        try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
            Future<KestraExecutionPage> pageFuture = pageFiltersOpt.isPresent()
                    ? executor.submit(() -> safePage(kestraClient.searchExecutionsPage(
                            pageFiltersOpt.get(), requestedPage, pageSize, SORT_START_DATE_DESC)))
                    : null;
            Future<Long> totalFuture = normalizedStatus == null
                    ? null
                    : submitCountQuery(executor, baseFilters);
            Future<Long> successFuture = "SUCCESS".equals(normalizedStatus)
                    ? null
                    : submitCountQuery(executor, withSingleState(baseFilters, "SUCCESS"));
            Future<Long> failedFuture = "FAILED".equals(normalizedStatus)
                    ? null
                    : submitCountQuery(executor, withSingleState(baseFilters, "FAILED"));
            Future<Long> activeFuture = "ACTIVE".equals(normalizedStatus)
                    ? null
                    : submitCountQuery(executor, withStateIn(baseFilters, ACTIVE_STATES_PARAM));
            Future<Long> stoppedFuture = "STOPPED".equals(normalizedStatus)
                    ? null
                    : submitCountQuery(executor, withStateIn(baseFilters, STOPPED_STATES_PARAM));

            mainPage = pageFuture == null ? KestraExecutionPage.empty() : awaitFuture(pageFuture);
            fetchedTotalCount = totalFuture == null ? null : awaitFuture(totalFuture);
            fetchedSuccessCount = successFuture == null ? null : awaitFuture(successFuture);
            fetchedFailedCount = failedFuture == null ? null : awaitFuture(failedFuture);
            fetchedActiveCount = activeFuture == null ? null : awaitFuture(activeFuture);
            fetchedStoppedCount = stoppedFuture == null ? null : awaitFuture(stoppedFuture);
        }

        if (pageFiltersOpt.isPresent()) {
            if (requestedPage > DEFAULT_PAGE && mainPage.results().isEmpty() && mainPage.total() == 0) {
                KestraExecutionPage firstPage = safePage(kestraClient.searchExecutionsPage(
                        pageFiltersOpt.get(), DEFAULT_PAGE, pageSize, SORT_START_DATE_DESC));
                int firstTotal = toCount(firstPage.total());
                int firstTotalPages = firstTotal == 0 ? 0 : (int) Math.ceil((double) firstTotal / pageSize);
                if (firstTotalPages <= DEFAULT_PAGE) {
                    mainPage = firstPage;
                } else {
                    int clampedPage = normalizePage(effectiveQuery.page(), firstTotalPages);
                    mainPage = safePage(kestraClient.searchExecutionsPage(
                            pageFiltersOpt.get(), clampedPage, pageSize, SORT_START_DATE_DESC));
                }
            } else {
                int initialTotal = toCount(mainPage.total());
                int initialTotalPages = initialTotal == 0 ? 0 : (int) Math.ceil((double) initialTotal / pageSize);
                if (initialTotalPages > 0 && requestedPage > initialTotalPages) {
                    int clampedPage = normalizePage(effectiveQuery.page(), initialTotalPages);
                    mainPage = safePage(kestraClient.searchExecutionsPage(
                            pageFiltersOpt.get(), clampedPage, pageSize, SORT_START_DATE_DESC));
                }
            }
        }

        int total = toCount(mainPage.total());
        int totalPages = total == 0 ? 0 : (int) Math.ceil((double) total / pageSize);
        int effectivePage = normalizePage(effectiveQuery.page(), totalPages);
        int totalCount = fetchedTotalCount == null ? total : toCount(fetchedTotalCount);
        int successCount = fetchedSuccessCount == null ? total : toCount(fetchedSuccessCount);
        int failedCount = fetchedFailedCount == null ? total : toCount(fetchedFailedCount);
        int activeCount = fetchedActiveCount == null ? total : toCount(fetchedActiveCount);
        int stoppedCount = fetchedStoppedCount == null ? total : toCount(fetchedStoppedCount);

        Map<String, KestraExecutionSnapshot> snapshotsById = new LinkedHashMap<>();
        List<OperationsExecutionListItem> rawPageItems = new java.util.ArrayList<>(mainPage.results().size());
        for (KestraExecutionSnapshot execution : mainPage.results()) {
            if (!isBusinessExecution(execution, namespaceToBranch)) {
                continue;
            }
            if (execution.id() != null) {
                snapshotsById.put(execution.id(), execution);
            }
            rawPageItems.add(toListItem(execution, namespaceToBranch.get(execution.namespace())));
        }

        Set<String> manualRerunIds = findRerunIds(rawPageItems.stream().map(OperationsExecutionListItem::id).toList());
        Map<String, Long> flowOwnerIdMap = loadFlowOwnerIdMap(groupId, rawPageItems);
        Map<Long, GroupOwnerInfo> ownerInfoMap = resolvePageOwners(groupId, flowOwnerIdMap);
        List<OperationsExecutionListItem> pageExecutions = rawPageItems.stream()
                .map(item -> {
                    OperationsRerunClassifier.Classification classification = OperationsRerunClassifier.classify(
                            snapshotsById.get(item.id()), manualRerunIds);
                    Long ownerUserId = flowOwnerIdMap.get(item.flowId());
                    GroupOwnerInfo ownerInfo = ownerUserId == null ? null : ownerInfoMap.get(ownerUserId);
                    return new OperationsExecutionListItem(
                            item.id(), item.namespace(), item.flowId(), item.branch(), item.status(),
                            item.plannedAt(), item.createdAt(), item.startDate(), item.endDate(),
                            item.durationMs(), item.rerunnable(), item.stoppable(),
                            classification.rerun(), classification.rerunType(), classification.retryAttempt(),
                            classification.partialRerun(), classification.rerunSelectedTaskCount(),
                            classification.rerunTotalTaskCount(), item.markableSuccess(),
                            ownerUserId,
                            ownerInfo != null ? ownerInfo.effectiveName() : null,
                            ownerInfo != null ? ownerInfo.username() : null,
                            ownerInfo != null ? ownerInfo.status() : null);
                })
                .toList();

        return new OperationsExecutionListResponse(
                namespaceToBranch.values().stream().toList(),
                blankToNull(effectiveQuery.branch()),
                from,
                to,
                effectivePage,
                pageSize,
                total,
                totalPages,
                pageExecutions,
                new OperationsExecutionStatusCounts(totalCount, successCount, failedCount, activeCount, stoppedCount)
        );
    }

    public OperationsExecutionDetailResponse getExecution(Long groupId, String executionId) {
        Scope scope = loadScope(groupId);
        KestraExecutionSnapshot execution = requireAccessibleExecution(scope, executionId);
        Set<String> manualRerunIds = execution.id() == null ? Set.of() : findRerunIds(List.of(execution.id()));
        return toDetail(groupId, execution, scope.branchFor(execution.namespace()),
                OperationsRerunClassifier.classify(execution, manualRerunIds));
    }

    public List<ExecutionLogEntry> getLogs(Long groupId, String executionId, String taskId) {
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

    public OperationsExecutionRerunContextResponse getRerunContext(Long groupId, String executionId) {
        Scope scope = loadScope(groupId);
        KestraExecutionSnapshot original = requireAccessibleExecution(scope, executionId);
        String flowSource = requireCurrentFlowSourceForRerun(original.namespace(), original.flowId());
        OfflineFlowInspector.InspectedGraph graph = flowInspector.inspectGraph(flowSource);
        return OperationsRerunGraphPlanner.buildContext(original, graph);
    }

    public OperationsExecutionRerunResponse rerunExecution(Long groupId,
                                                            Long requestedBy,
                                                            String executionId,
                                                            boolean reuseManualOverrides) {
        return rerunExecution(groupId, requestedBy, executionId, reuseManualOverrides, null);
    }

    public OperationsExecutionRerunResponse rerunExecution(Long groupId,
                                                            Long requestedBy,
                                                            String executionId,
                                                            boolean reuseManualOverrides,
                                                            List<String> selectedTaskIds) {
        Scope scope = loadScope(groupId);
        KestraExecutionSnapshot original = requireAccessibleExecution(scope, executionId);
        if (!rerunnable(OperationsForceSuccess.effectiveStatus(original))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "当前状态不支持重跑");
        }

        String currentFlowSource = selectedTaskIds != null
                ? requireCurrentFlowSourceForRerun(original.namespace(), original.flowId())
                : kestraClient.getFlowSource(original.namespace(), original.flowId());
        OperationsRerunGraphPlanner.SelectionResolution selection;
        if (selectedTaskIds != null) {
            OfflineFlowInspector.InspectedGraph graph = flowInspector.inspectGraph(currentFlowSource);
            OperationsExecutionRerunContextResponse context = OperationsRerunGraphPlanner.buildContext(original, graph);
            selection = OperationsRerunGraphPlanner.resolveSelection(context, selectedTaskIds);
        } else {
            selection = new OperationsRerunGraphPlanner.SelectionResolution(false, List.of(), 0);
        }

        Map<String, String> rerunInputs = resolveRerunInputs(
                groupId, original, currentFlowSource, reuseManualOverrides);
        Set<String> originalOverrideKeys = splitLabelValues(labels(original).get(PARAMETER_OVERRIDE_KEYS_LABEL));
        String rerunOverrideKeys = reuseManualOverrides && !originalOverrideKeys.isEmpty()
                ? String.join("---", originalOverrideKeys)
                : NO_PARAMETER_OVERRIDES_LABEL_VALUE;
        Map<String, String> executionLabels = new LinkedHashMap<>();
        executionLabels.put(PARAMETER_OVERRIDE_KEYS_LABEL, rerunOverrideKeys);
        if (selection.partial()) {
            rerunInputs.put(OfflineFlowInspector.RERUN_TASKS_INPUT,
                    String.join(",", selection.orderedSelectedTaskIds()));
            executionLabels.put(OperationsRerunClassifier.RERUN_SELECTED_COUNT_LABEL,
                    String.valueOf(selection.orderedSelectedTaskIds().size()));
            executionLabels.put(OperationsRerunClassifier.RERUN_TOTAL_COUNT_LABEL,
                    String.valueOf(selection.totalNodeCount()));
        }

        KestraExecutionSnapshot rerun = kestraClient.createExecution(
                original.namespace(),
                original.flowId(),
                Map.copyOf(rerunInputs),
                Map.copyOf(executionLabels));

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

    public void stopExecution(Long groupId, Long requestedBy, String executionId) {
        Scope scope = loadScope(groupId);
        KestraExecutionSnapshot execution = requireAccessibleExecution(scope, executionId);
        if (!stoppable(execution.status())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "当前状态不支持停止");
        }
        kestraClient.killExecution(execution.id());

        WbOperationExecutionAction action = new WbOperationExecutionAction();
        action.setGroupId(groupId);
        action.setActionType("STOP");
        action.setOriginalExecutionId(execution.id());
        action.setNewExecutionId(null);
        action.setNamespace(execution.namespace());
        action.setFlowId(execution.flowId());
        action.setRequestedBy(requestedBy);
        action.setRequestedAt(LocalDateTime.now());
        try {
            actionMapper.insert(action);
        } catch (RuntimeException ex) {
            log.warn("停止执行 {} 成功，但写入操作审计记录失败", execution.id(), ex);
        }
    }

    public void markExecutionSuccess(Long groupId, Long requestedBy, String operatorName, String executionId) {
        Scope scope = loadScope(groupId);
        KestraExecutionSnapshot execution = requireAccessibleExecution(scope, executionId);
        String effectiveStatus = OperationsForceSuccess.effectiveStatus(execution);
        if (!OperationsForceSuccess.canMarkSuccess(effectiveStatus)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "当前状态不支持置成功");
        }
        Map<String, String> mergedLabels = OperationsForceSuccess.buildMergedLabels(
                execution.labels(),
                blankToNull(operatorName),
                Instant.now()
        );
        kestraClient.setExecutionLabels(execution.id(), mergedLabels);
        kestraClient.changeExecutionStatus(execution.id(), "SUCCESS");

        WbOperationExecutionAction action = new WbOperationExecutionAction();
        action.setGroupId(groupId);
        action.setActionType("MARK_SUCCESS");
        action.setOriginalExecutionId(execution.id());
        action.setNewExecutionId(null);
        action.setNamespace(execution.namespace());
        action.setFlowId(execution.flowId());
        action.setRequestedBy(requestedBy);
        action.setRequestedAt(LocalDateTime.now());
        try {
            actionMapper.insert(action);
        } catch (RuntimeException ex) {
            log.warn("置成功执行 {} 成功，但写入操作审计记录失败", execution.id(), ex);
        }
    }

    private Map<String, String> resolveRerunInputs(Long groupId,
                                                   KestraExecutionSnapshot original,
                                                   String currentFlowSource,
                                                   boolean reuseManualOverrides) {
        Map<String, String> rerunInputs = new LinkedHashMap<>();
        Map<String, String> originalInputs = original.inputs() == null ? Map.of() : original.inputs();
        Set<String> originalOverrideKeys = splitLabelValues(labels(original).get(PARAMETER_OVERRIDE_KEYS_LABEL));
        String currentSnapshotId = FlowParameterMetadata.readSnapshotId(currentFlowSource);
        com.wbdata.offline.parameter.dto.FlowParameterSnapshot currentSnapshot =
                currentSnapshotId == null || currentSnapshotId.isBlank()
                        ? null
                        : parameterSnapshotRegistry.find(groupId, currentSnapshotId)
                        .orElseThrow(() -> new ResponseStatusException(
                                HttpStatus.BAD_REQUEST, "当前任务 的参数快照已不可用，无法重跑"));
        if (reuseManualOverrides && !originalOverrideKeys.isEmpty()) {
            if (currentSnapshot == null) {
                throw new ResponseStatusException(
                        HttpStatus.BAD_REQUEST, "当前任务 没有参数定义，无法沿用原执行的手动覆盖值");
            }
            for (String overrideKey : originalOverrideKeys) {
                String value = originalInputs.get(overrideKey);
                if (value == null) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "原执行的手动参数值不完整，无法重跑");
                }
                if (!definesParameter(currentSnapshot, overrideKey)) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                            "参数 " + overrideKey + " 在当前任务 参数中已不存在，无法沿用覆盖值重跑");
                }
                rerunInputs.put(overrideKey, value);
            }
        }
        // 计划时间转发给所有声明了该 input 的 flow：参数体系（计划时间参数）与依赖闸门都会声明它；
        // 重跑该期靠它让闸门与参数拿到原业务期，而不是重跑时刻
        boolean forwardsPlannedTime = (currentSnapshot != null && hasPlannedTimeParameter(currentSnapshot))
                || FlowParameterMetadata.declaresInput(currentFlowSource, ExecutionTimeContext.PLANNED_TIME_INPUT);
        if (forwardsPlannedTime) {
            Instant plannedTime = readPlannedTime(original);
            if (plannedTime == null) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "原执行缺少计划时间，无法重跑");
            }
            rerunInputs.put(ExecutionTimeContext.PLANNED_TIME_INPUT, plannedTime.toString());
        }
        return rerunInputs;
    }

    private String requireCurrentFlowSourceForRerun(String namespace, String flowId) {
        try {
            String source = kestraClient.getFlowSource(namespace, flowId);
            if (source == null || source.isBlank()) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "任务已从线上分支删除，无法重跑");
            }
            return source;
        } catch (ResponseStatusException ex) {
            if (ex.getStatusCode() == HttpStatus.NOT_FOUND) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "任务已从线上分支删除，无法重跑", ex);
            }
            throw ex;
        }
    }

    private boolean definesParameter(com.wbdata.offline.parameter.dto.FlowParameterSnapshot snapshot, String key) {
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

    private boolean isBusinessNamespace(String namespace) {
        return namespace != null && !"system".equals(namespace) && !namespace.startsWith("wb-debug-");
    }

    @Nullable
    private List<String> resolveOwnedFlowIdsForFilter(Long groupId,
                                                      @Nullable Long ownerUserId,
                                                      @Nullable String flowFilter) {
        if (ownerUserId == null) {
            return null;
        }
        if (offlineFlowIndexService == null || !offlineFlowIndexService.isEnabled()) {
            return List.of();
        }
        List<WbOfflineFlowIndex> rows = offlineFlowIndexService.listFlowsByGroupAndOwner(groupId, ownerUserId);
        if (rows == null || rows.isEmpty()) {
            return List.of();
        }
        String normalizedFlowFilter = flowFilter == null ? null : flowFilter.toLowerCase(Locale.ROOT);
        LinkedHashSet<String> matchedIds = new LinkedHashSet<>();
        for (WbOfflineFlowIndex row : rows) {
            String flowId = row.getFlowId();
            if (flowId == null || flowId.isBlank()) {
                continue;
            }
            if (normalizedFlowFilter == null || flowId.toLowerCase(Locale.ROOT).contains(normalizedFlowFilter)) {
                matchedIds.add(flowId);
            }
        }
        return List.copyOf(matchedIds);
    }

    private Map<String, Long> loadFlowOwnerIdMap(Long groupId, List<OperationsExecutionListItem> items) {
        if (items.isEmpty() || offlineFlowIndexService == null || !offlineFlowIndexService.isEnabled()) {
            return Map.of();
        }
        Map<String, WbOfflineFlowIndex> flows = offlineFlowIndexService.listGroupFlowMap(groupId);
        if (flows.isEmpty()) {
            return Map.of();
        }
        Map<String, Long> result = new LinkedHashMap<>();
        for (WbOfflineFlowIndex row : flows.values()) {
            if (row != null && row.getFlowId() != null && row.getOwnerUserId() != null) {
                result.putIfAbsent(row.getFlowId(), row.getOwnerUserId());
            }
        }
        return result;
    }

    private Map<Long, GroupOwnerInfo> resolvePageOwners(Long groupId, Map<String, Long> flowOwnerIdMap) {
        if (groupOwnerService == null || flowOwnerIdMap.isEmpty()) {
            return Map.of();
        }
        Set<Long> ownerIds = new LinkedHashSet<>(flowOwnerIdMap.values());
        return ownerIds.isEmpty() ? Map.of() : groupOwnerService.resolveOwners(groupId, ownerIds);
    }

    private Map<String, String> buildBaseSearchFilters(List<String> namespaces,
                                                       Instant from,
                                                       Instant to,
                                                       String flowFilter,
                                                       @Nullable List<String> ownedFlowIds) {
        Map<String, String> filters = new LinkedHashMap<>();
        if (namespaces.size() == 1) {
            filters.put("filters[namespace][EQUALS]", namespaces.getFirst());
        } else {
            filters.put("filters[namespace][IN]", String.join(",", namespaces));
        }
        filters.put("startDate", toKestraSearchInstant(from));
        filters.put("endDate", toKestraSearchInstant(to));
        if (ownedFlowIds != null && !ownedFlowIds.isEmpty()) {
            if (ownedFlowIds.size() == 1) {
                filters.put("filters[flowId][EQUALS]", ownedFlowIds.getFirst());
            } else {
                filters.put("filters[flowId][IN]", String.join(",", ownedFlowIds));
            }
        } else if (flowFilter != null) {
            filters.put("filters[flowId][REGEX]", toCaseInsensitiveContainsRegex(flowFilter));
        }
        return filters;
    }

    private Optional<Map<String, String>> buildStatusFilters(Map<String, String> baseFilters, String statusFilter) {
        if (statusFilter == null) {
            return Optional.of(new LinkedHashMap<>(baseFilters));
        }
        return switch (statusFilter) {
            case "SUCCESS" -> Optional.of(withSingleState(baseFilters, "SUCCESS"));
            case OperationsForceSuccess.STATUS_FORCE_SUCCESS -> {
                Map<String, String> filters = withSingleState(baseFilters, "SUCCESS");
                filters.put("filters[labels][EQUALS][" + OperationsForceSuccess.LABEL_FORCE_SUCCESS + "]", "true");
                yield Optional.of(filters);
            }
            case "ACTIVE" -> Optional.of(withStateIn(baseFilters, ACTIVE_STATES_PARAM));
            case "STOPPED" -> Optional.of(withStateIn(baseFilters, STOPPED_STATES_PARAM));
            default -> KNOWN_KESTRA_STATES.contains(statusFilter)
                    ? Optional.of(withSingleState(baseFilters, statusFilter))
                    : Optional.empty();
        };
    }

    private Map<String, String> withSingleState(Map<String, String> baseFilters, String state) {
        Map<String, String> filters = new LinkedHashMap<>(baseFilters);
        filters.put("filters[state][EQUALS]", state);
        return filters;
    }

    private Map<String, String> withStateIn(Map<String, String> baseFilters, String statesCsv) {
        Map<String, String> filters = new LinkedHashMap<>(baseFilters);
        filters.put("filters[state][IN]", statesCsv);
        return filters;
    }

    private Future<Long> submitCountQuery(ExecutorService executor, Map<String, String> filters) {
        return executor.submit(() -> safePage(kestraClient.searchExecutionsPage(filters, 1, 1, null)).total());
    }

    private KestraExecutionPage safePage(KestraExecutionPage page) {
        return page == null ? KestraExecutionPage.empty() : page;
    }

    private <T> T awaitFuture(Future<T> future) {
        try {
            return future.get();
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("查询 Kestra 执行列表被中断", ex);
        } catch (ExecutionException ex) {
            if (ex.getCause() instanceof RuntimeException runtimeException) {
                throw runtimeException;
            }
            throw new IllegalStateException("查询 Kestra 执行列表失败", ex.getCause());
        }
    }

    private int toCount(long total) {
        return (int) Math.min(Integer.MAX_VALUE, Math.max(0L, total));
    }

    private String toCaseInsensitiveContainsRegex(String literal) {
        StringBuilder escaped = new StringBuilder(literal.length() + 16);
        for (int i = 0; i < literal.length(); i++) {
            char c = literal.charAt(i);
            if (REGEX_META_CHARS.indexOf(c) >= 0) {
                escaped.append('\\');
            }
            escaped.append(c);
        }
        return "(?i).*" + escaped + ".*";
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

    private OperationsExecutionListItem toListItem(KestraExecutionSnapshot execution, String branch) {
        String effectiveStatus = OperationsForceSuccess.effectiveStatus(execution);
        return new OperationsExecutionListItem(
                execution.id(),
                execution.namespace(),
                execution.flowId(),
                branch,
                effectiveStatus,
                readPlannedTime(execution),
                execution.createdAt(),
                execution.startDate(),
                execution.endDate(),
                durationMs(execution.startDate(), execution.endDate()),
                rerunnable(effectiveStatus),
                stoppable(effectiveStatus),
                false,
                "NONE",
                null,
                false,
                null,
                null,
                OperationsForceSuccess.canMarkSuccess(effectiveStatus)
        );
    }

    private Set<String> findRerunIds(List<String> ids) {
        if (ids == null || ids.isEmpty()) {
            return Set.of();
        }
        List<WbOperationExecutionAction> actions = actionMapper.selectList(
                new com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper<WbOperationExecutionAction>()
                        .eq(WbOperationExecutionAction::getActionType, "RERUN")
                        .in(WbOperationExecutionAction::getNewExecutionId, ids));
        if (actions == null) {
            return Set.of();
        }
        return actions.stream()
                .map(WbOperationExecutionAction::getNewExecutionId)
                .collect(java.util.stream.Collectors.toSet());
    }

    private OperationsExecutionDetailResponse toDetail(Long groupId,
                                                        KestraExecutionSnapshot execution,
                                                        String branch,
                                                        OperationsRerunClassifier.Classification classification) {
        List<ExecutionTaskRun> taskRuns = execution.taskRuns() == null
                ? List.of()
                : execution.taskRuns().stream()
                .filter(taskRun -> taskRun != null)
                .filter(this::isUserTaskRun)
                .map(this::toTaskRun)
                .toList();
        ParameterDetail parameterDetail = resolveParameterDetail(groupId, execution);
        String effectiveStatus = OperationsForceSuccess.effectiveStatus(execution);
        return new OperationsExecutionDetailResponse(
                execution.id(),
                execution.namespace(),
                execution.flowId(),
                branch,
                effectiveStatus,
                readPlannedTime(execution),
                execution.createdAt(),
                execution.startDate(),
                execution.endDate(),
                durationMs(execution.startDate(), execution.endDate()),
                rerunnable(effectiveStatus),
                stoppable(effectiveStatus),
                taskRuns,
                execution.inputs() == null ? Map.of() : execution.inputs(),
                execution.labels() == null ? Map.of() : execution.labels(),
                parameterDetail.status(),
                parameterDetail.parameters(),
                resolveParameterSnapshotChanged(execution),
                classification.rerun(),
                classification.rerunType(),
                classification.retryAttempt(),
                classification.partialRerun(),
                classification.rerunSelectedTaskCount(),
                classification.rerunTotalTaskCount(),
                OperationsForceSuccess.canMarkSuccess(effectiveStatus),
                OperationsForceSuccess.isForceSuccess(execution),
                OperationsForceSuccess.forceSuccessBy(execution),
                OperationsForceSuccess.forceSuccessAt(execution)
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
            String status = hasNonSystemInputs(execution.inputs()) ? "UNAVAILABLE" : "NONE";
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

    private boolean hasNonSystemInputs(Map<String, String> inputs) {
        if (inputs == null || inputs.isEmpty()) {
            return false;
        }
        return inputs.keySet().stream().anyMatch(key -> !SYSTEM_INPUT_KEYS.contains(key));
    }

    private boolean hasPlannedTimeParameter(com.wbdata.offline.parameter.dto.FlowParameterSnapshot snapshot) {
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
            List<com.wbdata.offline.parameter.dto.ExecutionParameterValueResponse> parameters
    ) {
    }

    private ExecutionTaskRun toTaskRun(KestraTaskRunSnapshot taskRun) {
        return ExecutionTaskRun.of(
                taskRun.taskId(),
                taskRun.status(),
                taskRun.startDate(),
                taskRun.endDate()
        );
    }

    private boolean isUserTaskRun(KestraTaskRunSnapshot taskRun) {
        String taskId = taskRun.taskId();
        return taskId != null && !"flow_dag".equals(taskId) && !taskId.startsWith("parallel_");
    }

    private ExecutionLogEntry toLogEntry(KestraLogEntry log) {
        return new ExecutionLogEntry(
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

    private boolean stoppable(String status) {
        if (status == null) {
            return false;
        }
        String normalized = status.toUpperCase(Locale.ROOT);
        return "CREATED".equals(normalized)
                || "QUEUED".equals(normalized)
                || "RUNNING".equals(normalized)
                || "PAUSED".equals(normalized)
                || "RETRYING".equals(normalized);
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
