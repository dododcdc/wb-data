package com.wbdata.operations.service;

import com.cronutils.model.CronType;
import com.cronutils.model.definition.CronDefinitionBuilder;
import com.cronutils.model.time.ExecutionTime;
import com.cronutils.parser.CronParser;
import com.wbdata.offline.enums.OfflineSchedulePeriod;
import com.wbdata.offline.service.OfflineScheduleKeys;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.YearMonth;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.IsoFields;
import java.time.temporal.WeekFields;
import java.util.Optional;

/**
 * 调度业务期与 Cron 点火时间的换算：与 Kestra 插件 ScheduleKeys 同语义（同一 cron-utils 库）。
 * 只处理标准周期；CUSTOM 由调用方先行拒绝。
 */
final class OperationsScheduleWindows {

    private static final DateTimeFormatter HOURLY_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH");
    private static final CronParser UNIX_CRON_PARSER =
            new CronParser(CronDefinitionBuilder.instanceDefinitionFor(CronType.UNIX));

    private OperationsScheduleWindows() {
    }

    static Optional<ExecutionTime> cronTime(String cron) {
        if (cron == null || cron.isBlank()) {
            return Optional.empty();
        }
        try {
            return Optional.of(ExecutionTime.forCron(UNIX_CRON_PARSER.parse(cron.trim())));
        } catch (IllegalArgumentException ex) {
            return Optional.empty();
        }
    }

    /** 业务期键 → 该期起点（任务时区）。 */
    static ZonedDateTime periodStart(OfflineSchedulePeriod period, String scheduleKey, java.time.ZoneId zone) {
        try {
            return switch (period) {
                case DAILY -> LocalDate.parse(scheduleKey.trim()).atStartOfDay(zone);
                case HOURLY -> LocalDateTime.parse(scheduleKey.trim(), HOURLY_FORMAT).atZone(zone);
                case WEEKLY -> weeklyStart(scheduleKey.trim(), zone);
                case MONTHLY -> YearMonth.parse(scheduleKey.trim()).atDay(1).atStartOfDay(zone);
                case YEARLY -> LocalDate.of(Integer.parseInt(scheduleKey.trim()), 1, 1).atStartOfDay(zone);
                case CUSTOM -> throw new IllegalArgumentException("自定义 Cron 调度没有可靠的计划业务期");
            };
        } catch (RuntimeException ex) {
            throw new IllegalArgumentException("业务期格式与调度频率不匹配: " + scheduleKey, ex);
        }
    }

    static ZonedDateTime periodEnd(OfflineSchedulePeriod period, ZonedDateTime periodStart) {
        return shiftPeriod(period, periodStart, 1);
    }

    static ZonedDateTime shiftPeriod(OfflineSchedulePeriod period, ZonedDateTime time, int amount) {
        return switch (period) {
            case HOURLY -> time.plusHours(amount);
            case DAILY -> time.plusDays(amount);
            case WEEKLY -> time.plusWeeks(amount);
            case MONTHLY -> time.plusMonths(amount);
            case YEARLY -> time.plusYears(amount);
            case CUSTOM -> throw new IllegalArgumentException("自定义 Cron 调度没有可靠的计划业务期");
        };
    }

    /** 本期计划点火时间：[periodStart, periodEnd) 内的第一次 Cron 点火。 */
    static Optional<ZonedDateTime> plannedFire(ExecutionTime cronTime, ZonedDateTime periodStart, ZonedDateTime periodEnd) {
        return cronTime.nextExecution(periodStart.minusSeconds(1))
                .filter(fire -> fire.isBefore(periodEnd));
    }

    /** 给定时刻所属业务期的计划点火时间（最近一次已过的点火）。 */
    static Optional<ZonedDateTime> lastFire(ExecutionTime cronTime, ZonedDateTime time) {
        return cronTime.lastExecution(time);
    }

    static String key(OfflineSchedulePeriod period, ZonedDateTime plannedTime) {
        return OfflineScheduleKeys.scheduleKey(period, plannedTime);
    }

    private static ZonedDateTime weeklyStart(String scheduleKey, java.time.ZoneId zone) {
        int separator = scheduleKey.indexOf("-W");
        if (separator <= 0) {
            throw new IllegalArgumentException("周业务期格式应为 yyyy-Www: " + scheduleKey);
        }
        int weekBasedYear = Integer.parseInt(scheduleKey.substring(0, separator));
        int week = Integer.parseInt(scheduleKey.substring(separator + 2));
        LocalDate monday = LocalDate.now(zone)
                .with(WeekFields.ISO.weekBasedYear(), weekBasedYear)
                .with(WeekFields.ISO.weekOfWeekBasedYear(), week)
                .with(DayOfWeek.MONDAY);
        if (monday.get(IsoFields.WEEK_BASED_YEAR) != weekBasedYear
                || monday.get(IsoFields.WEEK_OF_WEEK_BASED_YEAR) != week) {
            throw new IllegalArgumentException("非法周业务期: " + scheduleKey);
        }
        return monday.atStartOfDay(zone);
    }
}
