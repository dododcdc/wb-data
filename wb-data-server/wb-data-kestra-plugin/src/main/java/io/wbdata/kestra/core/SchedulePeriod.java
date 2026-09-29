package io.wbdata.kestra.core;

import java.util.Locale;

/**
 * 标准调度频率，与后端 com.wbdata.offline.enums.OfflineSchedulePeriod 语义一一对应。
 * CUSTOM（存量非标准 Cron）没有可靠的计划业务期，不允许参与依赖。
 */
public enum SchedulePeriod {
    HOURLY,
    DAILY,
    WEEKLY,
    MONTHLY,
    YEARLY;

    public static SchedulePeriod parse(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("调度频率不能为空");
        }
        try {
            return SchedulePeriod.valueOf(value.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException ex) {
            throw new IllegalArgumentException("不支持的调度频率: " + value, ex);
        }
    }
}
