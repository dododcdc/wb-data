package io.wbdata.kestra.core;

import io.kestra.core.exceptions.IllegalVariableEvaluationException;
import io.kestra.core.models.annotations.Plugin;
import io.kestra.core.models.executions.Execution;
import io.kestra.core.models.executions.ExecutionTrigger;
import io.kestra.core.models.flows.Flow;
import io.kestra.core.models.flows.State;
import io.kestra.core.models.property.Property;
import io.kestra.core.models.tasks.Output;
import io.kestra.core.models.tasks.RunnableTask;
import io.kestra.core.models.tasks.Task;
import io.kestra.core.repositories.ArrayListTotal;
import io.kestra.core.repositories.ExecutionRepositoryInterface;
import io.kestra.core.repositories.FlowRepositoryInterface;
import io.kestra.core.runners.DefaultRunContext;
import io.kestra.core.runners.RunContext;
import io.kestra.plugin.core.trigger.Schedule;
import io.micronaut.context.ApplicationContext;
import io.micronaut.data.model.Pageable;
import io.micronaut.data.model.Sort;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import lombok.Builder;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.ToString;
import lombok.experimental.SuperBuilder;
import org.slf4j.Logger;

import java.time.DateTimeException;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;

/**
 * wb-data 任务依赖闸门：等待所有前置任务在「同一计划业务期」达到 SUCCESS 才放行。
 *
 * <p>语义（docs/proposals/task-level-dependencies-v1.md §3/§6）：
 * <ul>
 *   <li>对齐键 scheduleKey 由计划执行时间按各自任务的时区计算，本类用 Java 计算（Pebble 周格式非 ISO）。</li>
 *   <li>启动时刻 = max(自己计划时间, 前置同期完成时间)：本 task 由 Schedule 到点点火，前置未齐则在此等待。</li>
 *   <li>超时边界 = 下一个计划点火点（最多等一个自己的周期），超时抛 {@link GateTimeoutException}。</li>
 *   <li>上一期失败策略 PAUSE 在等前置之前独立判断，挡住时抛 {@link GatePausedException}。</li>
 *   <li>手动触发经 wbdata_bypass_gate 输入旁路；debug flow 生成时整个 task 被剥除，不经过这里。</li>
 * </ul>
 */
@SuperBuilder
@ToString
@EqualsAndHashCode
@Getter
@NoArgsConstructor
@Schema(title = "等待前置任务同一计划业务期成功（wb-data 任务依赖闸门）")
@Plugin
public class WaitUpstream extends Task implements RunnableTask<WaitUpstream.WaitOutput> {

    static final String PLANNED_TIME_INPUT = "wbdata_planned_time";
    static final String SCHEDULE_PERIOD_LABEL = "wbdataSchedulePeriod";
    static final Set<State.Type> SATISFIED_STATES = EnumSet.of(State.Type.SUCCESS);
    static final Set<State.Type> TERMINAL_STATES = EnumSet.of(
            State.Type.SUCCESS, State.Type.WARNING, State.Type.FAILED, State.Type.KILLED, State.Type.CANCELLED);
    private static final int HEARTBEAT_POLLS = 20;

    @Schema(title = "前置任务列表", description = "仅允许相同调度频率；留空表示无前置，闸门直接通过")
    @Builder.Default
    private List<Upstream> upstreams = List.of();

    @NotNull
    @Schema(title = "本任务所属项目组 ID", description = "用于从运行时命名空间推导分支段")
    private Property<String> selfGroupId;

    @NotNull
    @Schema(title = "本任务调度频率", description = "HOURLY | DAILY | WEEKLY | MONTHLY | YEARLY")
    private Property<String> period;

    @NotNull
    @Schema(title = "本任务调度 Cron", description = "用于计算等待超时边界（下一个计划点火点）")
    private Property<String> cron;

    @Schema(title = "本任务调度时区", description = "缺省 UTC；scheduleKey 按此时区计算")
    private Property<String> timezone;

    @NotNull
    @Schema(title = "本期计划执行时间", description = "取 {{ trigger.date ?? inputs.wbdata_planned_time }}")
    private Property<String> plannedTime;

    @Schema(title = "上一期失败策略", description = "CONTINUE（默认）| PAUSE；只影响自身下一期，不影响下游")
    private Property<String> failurePolicy;

    @Schema(title = "旁路闸门", description = "手动触发时由 wbdata_bypass_gate 输入置 true，立即放行")
    private Property<Boolean> bypass;

    @Schema(title = "轮询间隔", description = "默认 PT30S")
    private Property<Duration> pollInterval;

    @Schema(title = "单次扫描每个前置的执行条数", description = "默认 100")
    private Property<Integer> fetchSize;

    @Override
    public WaitOutput run(RunContext runContext) throws Exception {
        Logger logger = runContext.logger();
        if (runContext.render(bypass).as(Boolean.class).orElse(false)) {
            logger.info("手动触发旁路依赖闸门，立即放行");
            return WaitOutput.builder().bypassed(true).build();
        }

        SchedulePeriod ownPeriod = SchedulePeriod.parse(renderRequired(runContext, period, "period"));
        ZoneId ownZone = ZoneId.of(renderOptional(runContext, timezone).filter(tz -> !tz.isBlank()).orElse("UTC"));
        ZonedDateTime planned = parsePlannedTime(renderRequired(runContext, plannedTime, "plannedTime"))
                .withZoneSameInstant(ownZone);
        String ownCron = renderRequired(runContext, cron, "cron");
        String scheduleKey = ScheduleKeys.key(ownPeriod, planned);

        ApplicationContext applicationContext = ((DefaultRunContext) runContext).getApplicationContext();
        ExecutionRepositoryInterface executionRepository = applicationContext.getBean(ExecutionRepositoryInterface.class);
        FlowRepositoryInterface flowRepository = applicationContext.getBean(FlowRepositoryInterface.class);
        String tenant = runContext.flowInfo().tenantId();
        int pageSize = runContext.render(fetchSize).as(Integer.class).orElse(100);
        Pageable pageable = Pageable.from(1, pageSize, Sort.of(Sort.Order.desc("startDate")));

        if (isPausePolicy(renderOptional(runContext, failurePolicy))) {
            assertPreviousPeriodSucceeded(logger, executionRepository, tenant, runContext.flowInfo().namespace(),
                    runContext.flowInfo().id(), ownPeriod, ownZone, planned, scheduleKey, pageable);
        }

        List<ResolvedUpstream> resolved = resolveUpstreams(runContext, flowRepository, tenant,
                runContext.flowInfo().namespace());
        if (resolved.isEmpty()) {
            logger.info("未配置前置任务，闸门直接通过 (scheduleKey={})", scheduleKey);
            return WaitOutput.builder().scheduleKey(scheduleKey).bypassed(false).build();
        }

        ZonedDateTime deadline = ScheduleKeys.nextFire(ownCron, planned)
                .orElseGet(() -> planned.plus(ScheduleKeys.fallbackPeriod(ownPeriod)));
        Duration interval = runContext.render(pollInterval).as(Duration.class).orElse(Duration.ofSeconds(30));

        logger.info("依赖闸门口径：scheduleKey={}，前置={}，超时边界={}", scheduleKey,
                resolved.stream().map(ResolvedUpstream::displayName).toList(), deadline);
        return waitLoop(logger, executionRepository, tenant, resolved, scheduleKey, deadline, interval, ownZone, pageable);
    }

    private WaitOutput waitLoop(Logger logger, ExecutionRepositoryInterface executionRepository, String tenant,
                                List<ResolvedUpstream> resolved, String scheduleKey, ZonedDateTime deadline,
                                Duration interval, ZoneId zone, Pageable pageable) {
        List<String> lastWaiting = List.of();
        long polls = 0;
        while (true) {
            List<String> waiting = new ArrayList<>();
            for (ResolvedUpstream upstream : resolved) {
                if (!isSatisfied(executionRepository, tenant, upstream, scheduleKey, pageable)) {
                    waiting.add(upstream.displayName());
                }
            }
            if (waiting.isEmpty()) {
                logger.info("所有前置同期实例已 SUCCESS (scheduleKey={})，闸门通过", scheduleKey);
                return WaitOutput.builder().scheduleKey(scheduleKey).bypassed(false).build();
            }
            if (!ZonedDateTime.now(zone).isBefore(deadline)) {
                logger.warn("等待前置任务超时 (scheduleKey={}, deadline={}, 仍未就绪: {})", scheduleKey, deadline, waiting);
                throw new GateTimeoutException("等待前置任务同期 " + scheduleKey + " 实例超过一个调度周期: " + waiting);
            }
            if (!waiting.equals(lastWaiting) || polls % HEARTBEAT_POLLS == 0) {
                logger.info("等待前置任务同期 {} 实例 SUCCESS: {}", scheduleKey, waiting);
                lastWaiting = List.copyOf(waiting);
            }
            polls++;
            try {
                Thread.sleep(interval.toMillis());
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("依赖闸门等待被中断", ex);
            }
        }
    }

    /** 上一期失败策略：存在上一期执行且无一 SUCCESS 且全部终态 → 挡住本期。 */
    private void assertPreviousPeriodSucceeded(Logger logger, ExecutionRepositoryInterface executionRepository,
                                               String tenant, String namespace, String flowId,
                                               SchedulePeriod period, ZoneId zone, ZonedDateTime planned,
                                               String scheduleKey, Pageable pageable) {
        String previousKey = ScheduleKeys.key(period, ScheduleKeys.previousPeriod(period, planned));
        List<Execution> previous = matchingExecutions(executionRepository, tenant, namespace, flowId,
                period, zone, previousKey, pageable);
        if (previous.isEmpty()) {
            return;
        }
        boolean anySuccess = previous.stream().anyMatch(e -> SATISFIED_STATES.contains(e.getState().getCurrent()));
        boolean allTerminal = previous.stream().allMatch(e -> TERMINAL_STATES.contains(e.getState().getCurrent()));
        if (!anySuccess && allTerminal) {
            logger.warn("上一期 {} 终态非 SUCCESS，本期 {} 按 PAUSE 策略暂停", previousKey, scheduleKey);
            throw new GatePausedException("上一期 " + previousKey + " 终态非 SUCCESS，PAUSE 策略暂停本期 " + scheduleKey
                    + "；请恢复上一期后重跑该期");
        }
    }

    private boolean isSatisfied(ExecutionRepositoryInterface executionRepository, String tenant,
                                ResolvedUpstream upstream, String scheduleKey, Pageable pageable) {
        return matchingExecutions(executionRepository, tenant, upstream.namespace(), upstream.flowId(),
                upstream.period(), upstream.zone(), scheduleKey, pageable)
                .stream().anyMatch(e -> SATISFIED_STATES.contains(e.getState().getCurrent()));
    }

    private List<Execution> matchingExecutions(ExecutionRepositoryInterface executionRepository, String tenant,
                                               String namespace, String flowId, SchedulePeriod period, ZoneId zone,
                                               String scheduleKey, Pageable pageable) {
        ArrayListTotal<Execution> found = executionRepository.findByFlowId(tenant, namespace, flowId, pageable);
        return found.stream()
                .filter(e -> {
                    ZonedDateTime plannedTime = executionPlannedTime(e);
                    return plannedTime != null
                            && ScheduleKeys.key(period, plannedTime.withZoneSameInstant(zone)).equals(scheduleKey);
                })
                .toList();
    }

    private List<ResolvedUpstream> resolveUpstreams(RunContext runContext, FlowRepositoryInterface flowRepository,
                                                    String tenant, String ownNamespace)
            throws IllegalVariableEvaluationException {
        String selfGroupId = renderRequired(runContext, this.selfGroupId, "selfGroupId");
        List<ResolvedUpstream> resolved = new ArrayList<>();
        for (Upstream upstream : upstreams == null ? List.<Upstream>of() : upstreams) {
            String groupId = runContext.render(upstream.getGroupId()).as(String.class)
                    .orElseThrow(() -> new IllegalStateException("前置任务 groupId 不能为空"));
            String flowId = runContext.render(upstream.getFlowId()).as(String.class)
                    .orElseThrow(() -> new IllegalStateException("前置任务 flowId 不能为空"));
            String namespace = upstreamNamespace(selfGroupId, ownNamespace, groupId.trim());
            Flow flow = flowRepository.findById(tenant, namespace, flowId)
                    .orElseThrow(() -> new IllegalStateException(
                            "前置任务不存在: " + namespace + "/" + flowId + "（可能已被删除或未同步，请先解除依赖）"));
            Schedule schedule = flow.getTriggers() == null ? null : flow.getTriggers().stream()
                    .filter(Schedule.class::isInstance).map(Schedule.class::cast)
                    .findFirst().orElse(null);
            if (schedule == null) {
                throw new IllegalStateException("前置任务 " + namespace + "/" + flowId + " 未配置调度，无法对齐计划业务期");
            }
            String periodLabel = flow.getLabels() == null ? null : flow.getLabels().stream()
                    .filter(label -> SCHEDULE_PERIOD_LABEL.equals(label.key()))
                    .map(io.kestra.core.models.Label::value).findFirst().orElse(null);
            SchedulePeriod upstreamPeriod = SchedulePeriod.parse(periodLabel);
            ZoneId upstreamZone = ZoneId.of(schedule.getTimezone() == null || schedule.getTimezone().isBlank()
                    ? "UTC" : schedule.getTimezone());
            resolved.add(new ResolvedUpstream(namespace, flowId, upstreamPeriod, upstreamZone));
        }
        return resolved;
    }

    /**
     * 运行时命名空间推导：SyncFlows 会把 flow 同步到 g<groupId>-<branch> 命名空间（覆盖 YAML 里的 pg-N），
     * 因此同一分支下前置任务的命名空间 = g<上游 groupId>-(本任务命名空间的分支段)。
     * 分支名超长被 boundedIdentifier 截断时推导可能失配，属极端边缘场景，找不到 flow 时会报清晰错误。
     */
    static String upstreamNamespace(String selfGroupId, String ownNamespace, String upstreamGroupId) {
        String selfPrefix = "g" + selfGroupId + "-";
        if (ownNamespace == null || !ownNamespace.startsWith(selfPrefix)) {
            throw new IllegalStateException(
                    "依赖闸门要求运行时命名空间为 " + selfPrefix + "<branch> 形式，当前: " + ownNamespace);
        }
        return "g" + upstreamGroupId + "-" + ownNamespace.substring(selfPrefix.length());
    }

    /** 执行的计划时间：手动重跑以 wbdata_planned_time 输入为准，调度触发取 trigger.date。 */
    static ZonedDateTime executionPlannedTime(Execution execution) {
        Map<String, Object> inputs = execution.getInputs();
        Object fromInputs = inputs == null ? null : inputs.get(PLANNED_TIME_INPUT);
        if (fromInputs != null) {
            return parsePlannedTime(fromInputs);
        }
        ExecutionTrigger trigger = execution.getTrigger();
        Object date = trigger == null || trigger.getVariables() == null ? null : trigger.getVariables().get("date");
        return date == null ? null : parsePlannedTime(date);
    }

    static ZonedDateTime parsePlannedTime(Object raw) {
        Objects.requireNonNull(raw, "计划执行时间不能为空");
        if (raw instanceof ZonedDateTime zoned) {
            return zoned;
        }
        if (raw instanceof OffsetDateTime offset) {
            return offset.toZonedDateTime();
        }
        if (raw instanceof Instant instant) {
            return instant.atZone(ZoneId.of("UTC"));
        }
        String text = raw.toString().trim();
        List<DateTimeFormatter> formatters = List.of(
                DateTimeFormatter.ISO_ZONED_DATE_TIME,
                DateTimeFormatter.ISO_OFFSET_DATE_TIME,
                DateTimeFormatter.ISO_INSTANT,
                DateTimeFormatter.ISO_LOCAL_DATE_TIME);
        for (DateTimeFormatter formatter : formatters) {
            try {
                return toZoned(formatter.parse(text));
            } catch (DateTimeException ignored) {
                // 尝试下一种格式
            }
        }
        throw new IllegalArgumentException("无法解析计划执行时间: " + text);
    }

    private static ZonedDateTime toZoned(java.time.temporal.TemporalAccessor temporal) {
        try {
            return ZonedDateTime.from(temporal);
        } catch (DateTimeException ignored) {
            return java.time.LocalDateTime.from(temporal).atZone(ZoneId.of("UTC"));
        }
    }

    private boolean isPausePolicy(Optional<String> failurePolicy) {
        return failurePolicy.map(value -> "PAUSE".equals(value.trim().toUpperCase(Locale.ROOT))).orElse(false);
    }

    private String renderRequired(RunContext runContext, Property<String> property, String name)
            throws IllegalVariableEvaluationException {
        return runContext.render(property).as(String.class)
                .filter(value -> !value.isBlank())
                .orElseThrow(() -> new IllegalStateException("依赖闸门缺少必填参数: " + name));
    }

    private Optional<String> renderOptional(RunContext runContext, Property<String> property)
            throws IllegalVariableEvaluationException {
        return runContext.render(property).as(String.class);
    }

    record ResolvedUpstream(String namespace, String flowId, SchedulePeriod period, ZoneId zone) {
        String displayName() {
            return namespace + "/" + flowId;
        }
    }

    @SuperBuilder
    @Getter
    @NoArgsConstructor
    public static class Upstream {
        @NotNull
        @Schema(title = "前置任务所属项目组 ID")
        private Property<String> groupId;

        @NotNull
        @Schema(title = "前置任务 flowId")
        private Property<String> flowId;
    }

    @Builder
    @Getter
    public static class WaitOutput implements Output {
        @Schema(title = "本期计划业务期对齐键")
        private final String scheduleKey;

        @Schema(title = "是否被手动旁路")
        private final Boolean bypassed;
    }
}
