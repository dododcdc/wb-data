package com.wbdata.offline.schedule.dto;

import com.wbdata.offline.enums.OfflineSchedulePeriod;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record UpdateOfflineScheduleRequest(
        Long groupId,
        @NotBlank String path,
        @NotBlank String cron,
        @NotNull OfflineSchedulePeriod period,
        @NotBlank String contentHash,
        long fileUpdatedAt,
        Boolean retryEnabled,
        Integer retryCount,
        Integer retryIntervalMinutes
) {
    public UpdateOfflineScheduleRequest(
            Long groupId,
            String path,
            String cron,
            OfflineSchedulePeriod period,
            String contentHash,
            long fileUpdatedAt
    ) {
        this(groupId, path, cron, period, contentHash, fileUpdatedAt, null, null, null);
    }
}
