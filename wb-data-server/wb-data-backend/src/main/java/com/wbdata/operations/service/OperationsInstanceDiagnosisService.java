package com.wbdata.operations.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.cronutils.model.time.ExecutionTime;
import com.wbdata.auth.dto.ProjectGroupContextItem;
import com.wbdata.auth.enums.Permission;
import com.wbdata.auth.enums.SystemRole;
import com.wbdata.auth.service.PermissionService;
import com.wbdata.git.dto.GitSyncConfigResponse;
import com.wbdata.git.service.GitSyncConfigService;
import com.wbdata.git.service.GitSyncFlowSourceBuilder;
import com.wbdata.offline.schedule.dto.OfflineFlowDependencyRef;
import com.wbdata.offline.enums.OfflineFailurePolicy;
import com.wbdata.offline.enums.OfflineSchedulePeriod;
import com.wbdata.offline.kestra.KestraClient;
import com.wbdata.offline.kestra.KestraExecutionSnapshot;
import com.wbdata.offline.kestra.KestraTaskRunSnapshot;
import com.wbdata.offline.parameter.service.ExecutionTimeContext;
import com.wbdata.offline.service.OfflineFlowInspector;
import com.wbdata.operations.dto.OperationsInstanceDiagnosisResponse;
import com.wbdata.operations.dto.OperationsInstanceExecutionItem;
import com.wbdata.operations.dto.OperationsInstanceUpstreamItem;
import com.wbdata.operations.entity.WbOperationExecutionAction;
import com.wbdata.operations.mapper.WbOperationExecutionActionMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 调度实例诊断：回答「某任务某一业务期为什么是这个状态」。
 * 判定语义与依赖闸门 WaitUpstream 对齐（scheduleKey 按各任务时区由计划时间计算），
 * 不靠日志文本，全部实时重算。
 */
@Service
@RequiredArgsConstructor
public class OperationsInstanceDiagnosisService {

    public static final String STATE_NO_SCHEDULE = "NO_SCHEDULE";
    public static final String STATE_NOT_DUE = "NOT_DUE";
    public static final String STATE_PENDING_FIRE = "PENDING_FIRE";
    public static final String STATE_MISSED = "MISSED";
    public static final String STATE_SCHEDULE_DISABLED = "SCHEDULE_DISABLED";
    public static final String STATE_WAITING_UPSTREAM = "WAITING_UPSTREAM";
    public static final String STATE_GATE_TIMEOUT = "GATE_TIMEOUT";
    public static final String STATE_PAUSED_BY_POLICY = "PAUSED_BY_POLICY";
    public static final String STATE_UNSYNCED = "UNSYNCED";
    public static final String STATE_NOT_FIRED = "NOT_FIRED";

    static final String GATE_TASK_ID = "wb_upstream_gate";
    static final Duration FIRE_GRACE = Duration.ofMinutes(10);
    private static final Set<String> SATISFIED_STATES = Set.of("SUCCESS");
    private static final Set<String> TERMINAL_STATES = Set.of("SUCCESS", "WARNING", "FAILED", "KILLED", "CANCELLED");
    private static final Set<String> ACTIVE_STATES = Set.of("CREATED", "QUEUED", "RUNNING", "RETRYING");

    private final GitSyncConfigService gitSyncConfigService;
    private final KestraClient kestraClient;
    private final WbOperationExecutionActionMapper actionMapper;
    private final PermissionService permissionService;
    private final OfflineFlowInspector flowInspector = new OfflineFlowInspector();
    private java.time.Clock clock = java.time.Clock.systemUTC();

    void useClock(java.time.Clock testClock) {
        this.clock = testClock;
    }

    public OperationsInstanceDiagnosisResponse diagnose(Long groupId,
                                                        String branch,
                                                        String flowId,
                                                        String scheduleKey,
                                                        List<ProjectGroupContextItem> accessibleGroups) {
        if (branch == null || branch.isBlank() || flowId == null || flowId.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "分支与任务不能为空");
        }
        String namespace = requireNamespace(groupId, branch.trim());
        String flowSource = requireFlowSource(namespace, flowId.trim(), branch.trim());
        OfflineFlowInspector.InspectedFlow flow = flowInspector.inspect(flowSource);
        OfflineFlowInspector.InspectedSchedule schedule = flow.schedule();
        if (schedule == null) {
            return new OperationsInstanceDiagnosisResponse(flow.flowId(), branch.trim(), namespace,
                    null, null, null, null, false, null,
                    STATE_NO_SCHEDULE, "任务未配置调度，不会产生调度实例",
                    List.of(), List.of(), null, null);
        }
        if (schedule.period() == null || schedule.period() == OfflineSchedulePeriod.CUSTOM) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "自定义 Cron 调度暂不支持实例诊断");
        }
        ZoneId zone = schedule.timezone() == null || schedule.timezone().isBlank()
                ? ZoneId.of("UTC") : ZoneId.of(schedule.timezone().trim());
        ExecutionTime cronTime = OperationsScheduleWindows.cronTime(schedule.cron())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "调度 Cron 无法解析"));

        ZonedDateTime now = ZonedDateTime.now(clock).withZoneSameInstant(zone);
        ZonedDateTime plannedFire = resolvePlannedFire(schedule.period(), scheduleKey, cronTime, zone, now);
        String resolvedKey = OperationsScheduleWindows.key(schedule.period(), plannedFire);
        ZonedDateTime periodStart = OperationsScheduleWindows.periodStart(schedule.period(), resolvedKey, zone);
        ZonedDateTime periodEnd = OperationsScheduleWindows.periodEnd(schedule.period(), periodStart);

        List<KestraExecutionSnapshot> periodExecutions = findPeriodExecutions(
                namespace, flow.flowId(), schedule.period(), zone, resolvedKey, periodStart, periodEnd, now);
        Set<String> rerunIds = findRerunIds(periodExecutions);
        List<OperationsInstanceExecutionItem> executionItems = periodExecutions.stream()
                .map(execution -> toExecutionItem(execution, rerunIds))
                .toList();

        Set<Long> readableGroupIds = readableOfflineGroupIds(accessibleGroups);
        Map<Long, String> groupNames = accessibleGroups.stream()
                .collect(Collectors.toMap(ProjectGroupContextItem::id, ProjectGroupContextItem::name, (a, b) -> a));
        List<OperationsInstanceUpstreamItem> upstreams = new ArrayList<>();
        for (OfflineFlowDependencyRef dependency : flow.dependencies()) {
            upstreams.add(diagnoseUpstream(dependency, branch.trim(), resolvedKey,
                    readableGroupIds, groupNames, now));
        }

        String state;
        String reason = null;
        if (!executionItems.isEmpty()) {
            OperationsInstanceExecutionItem representative = executionItems.getFirst();
            KestraExecutionSnapshot representativeSnapshot = periodExecutions.getFirst();
            if (ACTIVE_STATES.contains(nullSafe(representative.status()))) {
                List<OperationsInstanceUpstreamItem> waiting = upstreams.stream()
                        .filter(upstream -> !upstream.satisfied())
                        .toList();
                if (isGateActive(representativeSnapshot) && !waiting.isEmpty()) {
                    state = STATE_WAITING_UPSTREAM;
                    reason = "依赖闸门等待上游同期实例: " + formatUpstreamNames(waiting, groupNames);
                } else {
                    state = representative.status();
                }
            } else if ("FAILED".equals(representative.status()) && isGateFailed(representativeSnapshot)) {
                String prevKey = OperationsScheduleWindows.key(schedule.period(),
                        OperationsScheduleWindows.shiftPeriod(schedule.period(), periodStart, -1));
                if (flow.failurePolicy() == OfflineFailurePolicy.PAUSE
                        && previousPeriodBlocked(namespace, flow.flowId(), schedule.period(), zone,
                        prevKey, periodStart, now)) {
                    state = STATE_PAUSED_BY_POLICY;
                    reason = "上一期 " + prevKey + " 终态非 SUCCESS，PAUSE 策略暂停本期；请恢复上一期后重跑该期";
                } else {
                    state = STATE_GATE_TIMEOUT;
                    List<OperationsInstanceUpstreamItem> waiting = upstreams.stream()
                            .filter(upstream -> !upstream.satisfied())
                            .toList();
                    reason = waiting.isEmpty()
                            ? "依赖闸门等待上游同期实例超过一个调度周期"
                            : "等待上游同期实例超过一个调度周期: " + formatUpstreamNames(waiting, groupNames);
                }
            } else {
                state = representative.status();
            }
        } else if (!schedule.enabled()) {
            state = STATE_SCHEDULE_DISABLED;
            reason = "调度已停用，本期不会触发";
        } else if (now.isBefore(plannedFire)) {
            state = STATE_NOT_DUE;
            reason = "未到计划点火时间";
        } else if (now.isBefore(plannedFire.plus(FIRE_GRACE))) {
            state = STATE_PENDING_FIRE;
            reason = "已到计划点火时间，等待调度器触发";
        } else {
            state = STATE_MISSED;
            reason = "超过计划点火时间仍未产生执行，疑似漏触发（调度停用、分支未同步或调度器异常）";
        }

        String prevKey = OperationsScheduleWindows.cronTime(schedule.cron())
                .flatMap(time -> time.lastExecution(plannedFire.minusSeconds(1)))
                .map(fire -> OperationsScheduleWindows.key(schedule.period(), fire))
                .orElse(null);
        String nextKey = cronTime.nextExecution(plannedFire)
                .map(fire -> OperationsScheduleWindows.key(schedule.period(), fire))
                .orElse(null);

        return new OperationsInstanceDiagnosisResponse(flow.flowId(), branch.trim(), namespace,
                resolvedKey, schedule.period().name(), schedule.cron(), zone.getId(), schedule.enabled(),
                plannedFire.toInstant(), state, reason, executionItems, upstreams, prevKey, nextKey);
    }

    /** 从执行记录定位实例：执行 → (branch, flowId, scheduleKey)，再走标准诊断。 */
    public OperationsInstanceDiagnosisResponse diagnoseByExecution(Long groupId,
                                                                   String executionId,
                                                                   List<ProjectGroupContextItem> accessibleGroups) {
        if (executionId == null || executionId.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "执行 ID 不能为空");
        }
        Map<String, String> namespaceToBranch = new LinkedHashMap<>();
        List<GitSyncConfigResponse> configs = gitSyncConfigService.listEnabledSyncConfigs(groupId);
        for (GitSyncConfigResponse config : configs == null ? List.<GitSyncConfigResponse>of() : configs) {
            if (config != null && config.namespace() != null && config.branch() != null) {
                namespaceToBranch.put(config.namespace(), config.branch());
            }
        }
        KestraExecutionSnapshot execution = kestraClient.getExecution(executionId.trim());
        if (execution == null || execution.namespace() == null || !namespaceToBranch.containsKey(execution.namespace())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "执行记录不存在");
        }
        String flowSource = requireFlowSource(execution.namespace(), execution.flowId(),
                namespaceToBranch.get(execution.namespace()));
        OfflineFlowInspector.InspectedFlow flow = flowInspector.inspect(flowSource);
        OfflineFlowInspector.InspectedSchedule schedule = flow.schedule();
        if (schedule == null || schedule.period() == null || schedule.period() == OfflineSchedulePeriod.CUSTOM) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "该任务没有标准调度，无法定位业务期");
        }
        ZoneId zone = schedule.timezone() == null || schedule.timezone().isBlank()
                ? ZoneId.of("UTC") : ZoneId.of(schedule.timezone().trim());
        ZonedDateTime plannedTime = executionPlannedTime(execution, zone);
        if (plannedTime == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "执行缺少计划时间，无法定位业务期");
        }
        String scheduleKey = OperationsScheduleWindows.key(schedule.period(), plannedTime);
        return diagnose(groupId, namespaceToBranch.get(execution.namespace()), execution.flowId(),
                scheduleKey, accessibleGroups);
    }

    private OperationsInstanceUpstreamItem diagnoseUpstream(OfflineFlowDependencyRef dependency,
                                                            String branch,
                                                            String scheduleKey,
                                                            Set<Long> readableGroupIds,
                                                            Map<Long, String> groupNames,
                                                            ZonedDateTime now) {
        String upstreamNamespace = GitSyncFlowSourceBuilder.buildKestraNamespace(dependency.groupId(), branch);
        boolean accessible = readableGroupIds.contains(dependency.groupId());
        String flowSource;
        try {
            flowSource = kestraClient.getFlowSource(upstreamNamespace, dependency.flowId());
        } catch (ResponseStatusException ex) {
            if (ex.getStatusCode() == HttpStatus.NOT_FOUND) {
                return new OperationsInstanceUpstreamItem(dependency.groupId(),
                        groupNames.get(dependency.groupId()), dependency.flowId(), upstreamNamespace,
                        scheduleKey, STATE_UNSYNCED, false, accessible, null);
            }
            throw ex;
        }
        OfflineFlowInspector.InspectedFlow upstreamFlow = flowInspector.inspect(flowSource);
        OfflineFlowInspector.InspectedSchedule upstreamSchedule = upstreamFlow.schedule();
        if (upstreamSchedule == null || upstreamSchedule.period() == null
                || upstreamSchedule.period() == OfflineSchedulePeriod.CUSTOM) {
            return new OperationsInstanceUpstreamItem(dependency.groupId(),
                    groupNames.get(dependency.groupId()), dependency.flowId(), upstreamNamespace,
                    scheduleKey, STATE_UNSYNCED, false, accessible, null);
        }
        ZoneId upstreamZone = upstreamSchedule.timezone() == null || upstreamSchedule.timezone().isBlank()
                ? ZoneId.of("UTC") : ZoneId.of(upstreamSchedule.timezone().trim());
        ZonedDateTime upstreamNow = now.withZoneSameInstant(upstreamZone);
        ZonedDateTime periodStart = OperationsScheduleWindows.periodStart(
                upstreamSchedule.period(), scheduleKey, upstreamZone);
        ZonedDateTime periodEnd = OperationsScheduleWindows.periodEnd(upstreamSchedule.period(), periodStart);
        List<KestraExecutionSnapshot> matches = findPeriodExecutions(upstreamNamespace, dependency.flowId(),
                upstreamSchedule.period(), upstreamZone, scheduleKey, periodStart, periodEnd, upstreamNow);
        KestraExecutionSnapshot representative = matches.isEmpty() ? null : matches.getFirst();
        boolean satisfied = matches.stream().anyMatch(execution -> SATISFIED_STATES.contains(execution.status()));
        String state = satisfied ? "SUCCESS"
                : representative == null ? STATE_NOT_FIRED
                : nullSafe(representative.status());
        return new OperationsInstanceUpstreamItem(dependency.groupId(),
                groupNames.get(dependency.groupId()), dependency.flowId(), upstreamNamespace,
                scheduleKey, state, satisfied, accessible,
                representative == null ? null : representative.id());
    }

    private boolean previousPeriodBlocked(String namespace,
                                          String flowId,
                                          OfflineSchedulePeriod period,
                                          ZoneId zone,
                                          String prevKey,
                                          ZonedDateTime periodStart,
                                          ZonedDateTime now) {
        ZonedDateTime prevStart = OperationsScheduleWindows.shiftPeriod(period, periodStart, -1);
        List<KestraExecutionSnapshot> previous = findPeriodExecutions(namespace, flowId, period, zone,
                prevKey, prevStart, periodStart, now);
        if (previous.isEmpty()) {
            return false;
        }
        boolean anySuccess = previous.stream().anyMatch(execution -> SATISFIED_STATES.contains(execution.status()));
        boolean allTerminal = previous.stream().allMatch(execution -> TERMINAL_STATES.contains(execution.status()));
        return !anySuccess && allTerminal;
    }

    /** 与闸门 matchingExecutions 同语义：按计划时间换算 scheduleKey 后匹配；窗口外扩以覆盖延迟重跑。 */
    private List<KestraExecutionSnapshot> findPeriodExecutions(String namespace,
                                                               String flowId,
                                                               OfflineSchedulePeriod period,
                                                               ZoneId zone,
                                                               String scheduleKey,
                                                               ZonedDateTime periodStart,
                                                               ZonedDateTime periodEnd,
                                                               ZonedDateTime now) {
        Instant from = periodStart.minusDays(1).toInstant();
        Instant searchEnd = OperationsScheduleWindows.shiftPeriod(period, periodEnd, 1).toInstant();
        Instant to = now.toInstant().isBefore(searchEnd) ? now.toInstant() : searchEnd;
        if (!from.isBefore(to)) {
            return List.of();
        }
        Map<String, String> filters = new LinkedHashMap<>();
        filters.put("filters[namespace][EQUALS]", namespace);
        filters.put("filters[flowId][EQUALS]", flowId);
        filters.put("startDate", toSearchInstant(from));
        filters.put("endDate", toSearchInstant(to));
        List<KestraExecutionSnapshot> found = kestraClient.searchExecutions(filters);
        if (found == null) {
            return List.of();
        }
        return found.stream()
                .filter(execution -> {
                    ZonedDateTime plannedTime = executionPlannedTime(execution, zone);
                    return plannedTime != null
                            && scheduleKey.equals(OperationsScheduleWindows.key(period, plannedTime));
                })
                .sorted(Comparator.comparing(KestraExecutionSnapshot::createdAt,
                        Comparator.nullsLast(Comparator.reverseOrder())))
                .toList();
    }

    /** 执行的计划时间：手动重跑以 wbdata_planned_time 输入为准，调度触发取 trigger.date（与闸门一致）。 */
    private ZonedDateTime executionPlannedTime(KestraExecutionSnapshot execution, ZoneId zone) {
        String input = execution.inputs() == null ? null : execution.inputs().get(ExecutionTimeContext.PLANNED_TIME_INPUT);
        Instant planned = parseInstant(input);
        if (planned == null) {
            planned = execution.plannedAt();
        }
        return planned == null ? null : planned.atZone(zone);
    }

    private Instant parseInstant(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return Instant.parse(raw.trim());
        } catch (RuntimeException ignored) {
            // 尝试带偏移量的格式
        }
        try {
            return DateTimeFormatter.ISO_OFFSET_DATE_TIME.parse(raw.trim(), java.time.OffsetDateTime::from).toInstant();
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    private ZonedDateTime resolvePlannedFire(OfflineSchedulePeriod period,
                                             String scheduleKey,
                                             ExecutionTime cronTime,
                                             ZoneId zone,
                                             ZonedDateTime now) {
        if (scheduleKey != null && !scheduleKey.isBlank()) {
            ZonedDateTime periodStart;
            try {
                periodStart = OperationsScheduleWindows.periodStart(period, scheduleKey.trim(), zone);
            } catch (IllegalArgumentException ex) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, ex.getMessage());
            }
            ZonedDateTime periodEnd = OperationsScheduleWindows.periodEnd(period, periodStart);
            return OperationsScheduleWindows.plannedFire(cronTime, periodStart, periodEnd)
                    .orElseThrow(() -> new ResponseStatusException(
                            HttpStatus.BAD_REQUEST, "该业务期内没有计划点火时间，期次与调度 Cron 不匹配"));
        }
        return OperationsScheduleWindows.lastFire(cronTime, now)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "调度 Cron 无法解析"));
    }

    private String requireNamespace(Long groupId, String branch) {
        List<GitSyncConfigResponse> configs = gitSyncConfigService.listEnabledSyncConfigs(groupId);
        if (configs == null) {
            configs = List.of();
        }
        return configs.stream()
                .filter(config -> branch.equals(config.branch()))
                .map(GitSyncConfigResponse::namespace)
                .findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "分支未配置同步: " + branch));
    }

    private String requireFlowSource(String namespace, String flowId, String branch) {
        try {
            return kestraClient.getFlowSource(namespace, flowId);
        } catch (ResponseStatusException ex) {
            if (ex.getStatusCode() == HttpStatus.NOT_FOUND) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "任务不存在或未同步到分支 " + branch);
            }
            throw ex;
        }
    }

    private Set<String> findRerunIds(List<KestraExecutionSnapshot> executions) {
        List<String> ids = executions.stream().map(KestraExecutionSnapshot::id).toList();
        if (ids.isEmpty()) {
            return Set.of();
        }
        List<WbOperationExecutionAction> actions = actionMapper.selectList(
                new LambdaQueryWrapper<WbOperationExecutionAction>()
                        .eq(WbOperationExecutionAction::getActionType, "RERUN")
                        .in(WbOperationExecutionAction::getNewExecutionId, ids));
        if (actions == null) {
            return Set.of();
        }
        return actions.stream().map(WbOperationExecutionAction::getNewExecutionId).collect(Collectors.toSet());
    }

    private OperationsInstanceExecutionItem toExecutionItem(KestraExecutionSnapshot execution, Set<String> rerunIds) {
        String input = execution.inputs() == null ? null : execution.inputs().get(ExecutionTimeContext.PLANNED_TIME_INPUT);
        Instant plannedAt = Optional.ofNullable(parseInstant(input)).orElse(execution.plannedAt());
        return new OperationsInstanceExecutionItem(
                execution.id(),
                execution.status(),
                plannedAt,
                execution.createdAt(),
                execution.startDate(),
                execution.endDate(),
                durationMs(execution.startDate(), execution.endDate()),
                rerunIds.contains(execution.id())
        );
    }

    private boolean isGateActive(KestraExecutionSnapshot execution) {
        return gateTaskRun(execution)
                .map(taskRun -> ACTIVE_STATES.contains(nullSafe(taskRun.status())))
                .orElse(false);
    }

    private boolean isGateFailed(KestraExecutionSnapshot execution) {
        return gateTaskRun(execution)
                .map(taskRun -> "FAILED".equals(taskRun.status()))
                .orElse(false);
    }

    private Optional<KestraTaskRunSnapshot> gateTaskRun(KestraExecutionSnapshot execution) {
        if (execution.taskRuns() == null) {
            return Optional.empty();
        }
        return execution.taskRuns().stream()
                .filter(taskRun -> taskRun != null && GATE_TASK_ID.equals(taskRun.taskId()))
                .findFirst();
    }

    private Set<Long> readableOfflineGroupIds(List<ProjectGroupContextItem> accessibleGroups) {
        return accessibleGroups.stream()
                .filter(group -> permissionService.resolveProjectPermissions(
                                group.role(), SystemRole.SYSTEM_ADMIN.name().equals(group.role()))
                        .contains(Permission.OFFLINE_READ.code()))
                .map(ProjectGroupContextItem::id)
                .collect(Collectors.toSet());
    }

    private String formatUpstreamNames(List<OperationsInstanceUpstreamItem> waiting, Map<Long, String> groupNames) {
        return waiting.stream()
                .map(upstream -> groupNames.getOrDefault(upstream.groupId(),
                        "项目组" + upstream.groupId()) + "/" + upstream.flowId())
                .collect(Collectors.joining("、"));
    }

    private String nullSafe(String value) {
        return value == null ? "" : value;
    }

    private Long durationMs(Instant start, Instant end) {
        if (start == null || end == null) {
            return null;
        }
        return Duration.between(start, end).toMillis();
    }

    private String toSearchInstant(Instant instant) {
        return DateTimeFormatter.ISO_INSTANT.format(instant.truncatedTo(ChronoUnit.MILLIS));
    }
}
