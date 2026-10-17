package com.wbdata.offline.enums;

import com.wbdata.schedule.StandardSchedulePeriod;

public enum OfflineSchedulePeriod {
    HOURLY,
    DAILY,
    WEEKLY,
    MONTHLY,
    YEARLY,
    CUSTOM;

    public StandardSchedulePeriod toStandardPeriod() {
        return switch (this) {
            case HOURLY -> StandardSchedulePeriod.HOURLY;
            case DAILY -> StandardSchedulePeriod.DAILY;
            case WEEKLY -> StandardSchedulePeriod.WEEKLY;
            case MONTHLY -> StandardSchedulePeriod.MONTHLY;
            case YEARLY -> StandardSchedulePeriod.YEARLY;
            case CUSTOM -> throw new IllegalArgumentException("自定义 Cron 调度没有可靠的计划业务期");
        };
    }
}
