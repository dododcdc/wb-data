package com.wbdata.offline.dto;

import jakarta.validation.constraints.NotBlank;

public record UpdateOfflineScheduleRequest(
        Long groupId,
        @NotBlank String path,
        @NotBlank String cron,
        String timezone,
        @NotBlank String contentHash,
        long fileUpdatedAt
) {
}
