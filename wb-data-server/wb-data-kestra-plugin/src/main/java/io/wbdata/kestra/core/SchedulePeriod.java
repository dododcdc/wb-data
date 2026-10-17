package io.wbdata.kestra.core;

import com.wbdata.schedule.StandardSchedulePeriod;

/**
 * 标准调度频率，与 wb-data-common-core 中的 {@link StandardSchedulePeriod} 语义一一对应。
 * CUSTOM（存量非标准 Cron）没有可靠的计划业务期，不允许参与依赖。
 */
public enum SchedulePeriod {
    HOURLY,
    DAILY,
    WEEKLY,
    MONTHLY,
    YEARLY;

    public static SchedulePeriod parse(String value) {
        StandardSchedulePeriod standard = StandardSchedulePeriod.parse(value);
        return SchedulePeriod.valueOf(standard.name());
    }

    public StandardSchedulePeriod toStandardPeriod() {
        return StandardSchedulePeriod.valueOf(this.name());
    }
}
