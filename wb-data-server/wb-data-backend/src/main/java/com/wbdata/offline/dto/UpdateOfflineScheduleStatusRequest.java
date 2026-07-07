package com.wbdata.offline.dto;

import jakarta.validation.constraints.NotBlank;

public record UpdateOfflineScheduleStatusRequest(
        Long groupId,
        @NotBlank String path,
        boolean enabled,
        @NotBlank String contentHash,
        long fileUpdatedAt
) {
}
