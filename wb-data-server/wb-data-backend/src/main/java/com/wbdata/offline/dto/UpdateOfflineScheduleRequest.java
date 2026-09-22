package com.wbdata.offline.dto;

import com.wbdata.offline.enums.OfflineSchedulePeriod;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record UpdateOfflineScheduleRequest(
        Long groupId,
        @NotBlank String path,
        @NotBlank String cron,
        @NotNull OfflineSchedulePeriod period,
        @NotBlank String contentHash,
        long fileUpdatedAt
) {
}
