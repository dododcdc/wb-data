package com.wbdata.offline.service;

import com.wbdata.offline.enums.OfflineSchedulePeriod;

import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.IsoFields;

/**
 * 计划业务期对齐键：只接受计划执行时间，禁止用实际启动时间倒推（延迟启动会错期）。
 */
public final class OfflineScheduleKeys {

    private static final DateTimeFormatter DAILY_FORMAT = DateTimeFormatter.ISO_LOCAL_DATE;
    private static final DateTimeFormatter HOURLY_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH");
    private static final DateTimeFormatter MONTHLY_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM");

    private OfflineScheduleKeys() {
    }

    public static String scheduleKey(OfflineSchedulePeriod period, ZonedDateTime plannedTime) {
        if (period == null || plannedTime == null) {
            throw new IllegalArgumentException("周期与计划执行时间不能为空");
        }
        return switch (period) {
            case DAILY -> plannedTime.format(DAILY_FORMAT);
            case HOURLY -> plannedTime.format(HOURLY_FORMAT);
            case WEEKLY -> weeklyKey(plannedTime);
            case MONTHLY -> plannedTime.format(MONTHLY_FORMAT);
            case YEARLY -> String.valueOf(plannedTime.getYear());
            case CUSTOM -> throw new IllegalArgumentException("自定义 Cron 调度没有可靠的计划业务期");
        };
    }

    private static String weeklyKey(ZonedDateTime plannedTime) {
        int weekBasedYear = plannedTime.get(IsoFields.WEEK_BASED_YEAR);
        int week = plannedTime.get(IsoFields.WEEK_OF_WEEK_BASED_YEAR);
        return String.format("%04d-W%02d", weekBasedYear, week);
    }
}
