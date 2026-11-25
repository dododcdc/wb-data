package com.wbdata.offline.schedule.dto;

import com.wbdata.offline.enums.OfflineSchedulePeriod;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record OfflineFlowSchedule(
        @NotBlank String cron,
        String timezone,
        boolean enabled,
        @NotNull OfflineSchedulePeriod period,
        boolean retryEnabled,
        Integer retryCount,
        Integer retryIntervalMinutes
) {
    public OfflineFlowSchedule(String cron, String timezone, boolean enabled, OfflineSchedulePeriod period) {
        this(cron, timezone, enabled, period, false, null, null);
    }
}
