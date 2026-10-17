package io.wbdata.kestra.core;

import com.cronutils.model.CronType;
import com.cronutils.model.definition.CronDefinitionBuilder;
import com.cronutils.model.time.ExecutionTime;
import com.cronutils.parser.CronParser;
import com.wbdata.schedule.SchedulePeriodKeys;

import java.time.Duration;
import java.time.ZonedDateTime;
import java.util.Optional;

/**
 * 计划业务期对齐键，底层委托 {@link SchedulePeriodKeys}（wb-data-common-core），与后端共用同一套实现。
 * 只接受计划执行时间，禁止用实际启动时间倒推（延迟启动会错期）。
 * 注意：不要在 Kestra Pebble 里用 YYYY/ww 算周键——其周规则随 JVM 默认 locale，不是 ISO 周。
 */
public final class ScheduleKeys {

    private static final CronParser UNIX_CRON_PARSER =
            new CronParser(CronDefinitionBuilder.instanceDefinitionFor(CronType.UNIX));

    private ScheduleKeys() {
    }

    public static String key(SchedulePeriod period, ZonedDateTime plannedTime) {
        if (period == null || plannedTime == null) {
            throw new IllegalArgumentException("周期与计划执行时间不能为空");
        }
        return SchedulePeriodKeys.key(period.toStandardPeriod(), plannedTime);
    }

    /** 上一期的代表时刻：按计划时间向前平移一个周期，再取 key 即为上一期。 */
    public static ZonedDateTime previousPeriod(SchedulePeriod period, ZonedDateTime plannedTime) {
        if (period == null || plannedTime == null) {
            throw new IllegalArgumentException("周期与计划执行时间不能为空");
        }
        return SchedulePeriodKeys.previousPeriod(period.toStandardPeriod(), plannedTime);
    }

    /** 下一个计划点火点：等待超时边界（「最多等一个自己的周期」）。月末与夏令时由 cron 库精确处理。 */
    public static Optional<ZonedDateTime> nextFire(String cron, ZonedDateTime plannedTime) {
        if (cron == null || cron.isBlank() || plannedTime == null) {
            return Optional.empty();
        }
        try {
            return ExecutionTime.forCron(UNIX_CRON_PARSER.parse(cron.trim())).nextExecution(plannedTime);
        } catch (IllegalArgumentException ex) {
            return Optional.empty();
        }
    }

    /** cron 解析失败时的兜底超时时长（取该周期的最长自然长度）。 */
    public static Duration fallbackPeriod(SchedulePeriod period) {
        if (period == null) {
            throw new IllegalArgumentException("周期不能为空");
        }
        return SchedulePeriodKeys.fallbackPeriod(period.toStandardPeriod());
    }
}
