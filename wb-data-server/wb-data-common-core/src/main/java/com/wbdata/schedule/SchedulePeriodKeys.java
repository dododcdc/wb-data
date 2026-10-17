package com.wbdata.schedule;

import java.time.DayOfWeek;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.YearMonth;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.IsoFields;
import java.time.temporal.WeekFields;

/**
 * 计划业务期对齐键与周期时间窗换算（纯 JDK 标准库实现，供后端与 Kestra 插件共同调用）。
 * 只接受计划执行时间，禁止用实际启动时间倒推（延迟启动会错期）。
 */
public final class SchedulePeriodKeys {

    private static final DateTimeFormatter DAILY_FORMAT = DateTimeFormatter.ISO_LOCAL_DATE;
    private static final DateTimeFormatter HOURLY_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH");
    private static final DateTimeFormatter MONTHLY_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM");

    private SchedulePeriodKeys() {
    }

    public static String key(StandardSchedulePeriod period, ZonedDateTime plannedTime) {
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

    /** 按计划时间平移指定个周期。 */
    public static ZonedDateTime shiftPeriod(StandardSchedulePeriod period, ZonedDateTime time, int amount) {
        if (period == null || time == null) {
            throw new IllegalArgumentException("周期与计划执行时间不能为空");
        }
        return switch (period) {
            case HOURLY -> time.plusHours(amount);
            case DAILY -> time.plusDays(amount);
            case WEEKLY -> time.plusWeeks(amount);
            case MONTHLY -> time.plusMonths(amount);
            case YEARLY -> time.plusYears(amount);
        };
    }

    /** 上一期的代表时刻：按计划时间向前平移一个周期，再取 key 即为上一期。 */
    public static ZonedDateTime previousPeriod(StandardSchedulePeriod period, ZonedDateTime plannedTime) {
        return shiftPeriod(period, plannedTime, -1);
    }

    /** 业务期键 → 该期起点（任务时区）。 */
    public static ZonedDateTime periodStart(StandardSchedulePeriod period, String scheduleKey, ZoneId zone) {
        if (period == null || scheduleKey == null || zone == null) {
            throw new IllegalArgumentException("周期、业务期键与时区不能为空");
        }
        try {
            return switch (period) {
                case DAILY -> LocalDate.parse(scheduleKey.trim()).atStartOfDay(zone);
                case HOURLY -> LocalDateTime.parse(scheduleKey.trim(), HOURLY_FORMAT).atZone(zone);
                case WEEKLY -> weeklyStart(scheduleKey.trim(), zone);
                case MONTHLY -> YearMonth.parse(scheduleKey.trim()).atDay(1).atStartOfDay(zone);
                case YEARLY -> LocalDate.of(Integer.parseInt(scheduleKey.trim()), 1, 1).atStartOfDay(zone);
            };
        } catch (RuntimeException ex) {
            throw new IllegalArgumentException("业务期格式与调度频率不匹配: " + scheduleKey, ex);
        }
    }

    /** 业务期终点（左闭右开区间的右边界）。 */
    public static ZonedDateTime periodEnd(StandardSchedulePeriod period, ZonedDateTime periodStart) {
        return shiftPeriod(period, periodStart, 1);
    }

    /** Cron 解析失败时的兜底超时时长（取该周期的最长自然长度）。 */
    public static Duration fallbackPeriod(StandardSchedulePeriod period) {
        if (period == null) {
            throw new IllegalArgumentException("周期不能为空");
        }
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

    private static ZonedDateTime weeklyStart(String scheduleKey, ZoneId zone) {
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
