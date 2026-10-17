package com.wbdata.schedule;

import java.util.Locale;

/**
 * 标准调度频率（跨后端与 Kestra 插件共享）。
 * CUSTOM（非标准 Cron）没有可靠的计划业务期，不允许参与依赖对齐。
 */
public enum StandardSchedulePeriod {
    HOURLY,
    DAILY,
    WEEKLY,
    MONTHLY,
    YEARLY;

    public static StandardSchedulePeriod parse(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("调度频率不能为空");
        }
        try {
            return StandardSchedulePeriod.valueOf(value.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException ex) {
            throw new IllegalArgumentException("不支持的调度频率: " + value, ex);
        }
    }
}
