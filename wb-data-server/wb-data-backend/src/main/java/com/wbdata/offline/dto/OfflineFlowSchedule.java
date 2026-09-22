package com.wbdata.offline.dto;

import com.wbdata.offline.enums.OfflineSchedulePeriod;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record OfflineFlowSchedule(
        @NotBlank String cron,
        String timezone,
        boolean enabled,
        @NotNull OfflineSchedulePeriod period
) {
}
