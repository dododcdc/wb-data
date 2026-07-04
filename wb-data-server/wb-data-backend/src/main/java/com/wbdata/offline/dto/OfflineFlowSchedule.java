package com.wbdata.offline.dto;

import jakarta.validation.constraints.NotBlank;

public record OfflineFlowSchedule(
        @NotBlank String cron,
        String timezone,
        boolean enabled
) {
}
