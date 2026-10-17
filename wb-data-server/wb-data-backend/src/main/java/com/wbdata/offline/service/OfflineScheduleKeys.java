package com.wbdata.offline.service;

import com.wbdata.offline.enums.OfflineSchedulePeriod;
import com.wbdata.schedule.SchedulePeriodKeys;

import java.time.ZonedDateTime;

/**
 * 计划业务期对齐键：只接受计划执行时间，禁止用实际启动时间倒推（延迟启动会错期）。
 */
public final class OfflineScheduleKeys {

    private OfflineScheduleKeys() {
    }

    public static String scheduleKey(OfflineSchedulePeriod period, ZonedDateTime plannedTime) {
        if (period == null || plannedTime == null) {
            throw new IllegalArgumentException("周期与计划执行时间不能为空");
        }
        return SchedulePeriodKeys.key(period.toStandardPeriod(), plannedTime);
    }
}
