package io.wbdata.kestra.core;

import com.cronutils.model.CronType;
import com.cronutils.model.definition.CronDefinitionBuilder;
import com.cronutils.model.time.ExecutionTime;
import com.cronutils.parser.CronParser;

import java.time.Duration;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.IsoFields;
import java.util.Optional;

/**
 * 计划业务期对齐键，与后端 com.wbdata.offline.service.OfflineScheduleKeys 保持同一语义与测试向量。
 * 只接受计划执行时间，禁止用实际启动时间倒推（延迟启动会错期）。
 * 注意：不要在 Kestra Pebble 里用 YYYY/ww 算周键——其周规则随 JVM 默认 locale，不是 ISO 周。
 */
public final class ScheduleKeys {

    private static final DateTimeFormatter DAILY_FORMAT = DateTimeFormatter.ISO_LOCAL_DATE;
    private static final DateTimeFormatter HOURLY_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH");
    private static final DateTimeFormatter MONTHLY_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM");
    private static final CronParser UNIX_CRON_PARSER =
            new CronParser(CronDefinitionBuilder.instanceDefinitionFor(CronType.UNIX));

    private ScheduleKeys() {
    }

    public static String key(SchedulePeriod period, ZonedDateTime plannedTime) {
        if (period == null || plannedTime == null) {
            throw new IllegalArgumentException("周期与计划执行时间不能为空");
        }
        return switch (period) {
            case DAILY -> plannedTime.format(DAILY_FORMAT);
            case HOURLY -> plannedTime.format(HOURLY_FORMAT);
            case WEEKLY -> weeklyKey(plannedTime);
            case MONTHLY -> plannedTime.format(MONTHLY_FORMAT);
            case YEARLY -> String.valueOf(plannedTime.getYear());
        };
    }

    /** 上一期的代表时刻：按计划时间向前平移一个周期，再取 key 即为上一期。 */
    public static ZonedDateTime previousPeriod(SchedulePeriod period, ZonedDateTime plannedTime) {
        if (period == null || plannedTime == null) {
            throw new IllegalArgumentException("周期与计划执行时间不能为空");
        }
        return switch (period) {
            case HOURLY -> plannedTime.minusHours(1);
            case DAILY -> plannedTime.minusDays(1);
            case WEEKLY -> plannedTime.minusWeeks(1);
            case MONTHLY -> plannedTime.minusMonths(1);
            case YEARLY -> plannedTime.minusYears(1);
        };
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
        return switch (period) {
            case HOURLY -> Duration.ofHours(1);
            case DAILY -> Duration.ofDays(1);
            case WEEKLY -> Duration.ofDays(7);
            case MONTHLY -> Duration.ofDays(31);
            case YEARLY -> Duration.ofDays(366);
        };
    }

    private static String weeklyKey(ZonedDateTime plannedTime) {
        int weekBasedYear = plannedTime.get(IsoFields.WEEK_BASED_YEAR);
        int week = plannedTime.get(IsoFields.WEEK_OF_WEEK_BASED_YEAR);
        return String.format("%04d-W%02d", weekBasedYear, week);
    }
}
