package com.wbdata.offline.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record UpdateOfflineScheduleStatusRequest(
        @NotNull Long groupId,
        @NotBlank String path,
        boolean enabled,
        @NotBlank String contentHash,
        long fileUpdatedAt
) {
}
