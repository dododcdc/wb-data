package com.wbdata.offline.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record SaveOfflineFlowRequest(
        @NotNull Long groupId,
        @NotBlank String path,
        @NotBlank String content,
        @NotBlank String contentHash,
        long fileUpdatedAt
) {
}
