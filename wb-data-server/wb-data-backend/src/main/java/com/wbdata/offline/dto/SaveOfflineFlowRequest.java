package com.wbdata.offline.dto;

import jakarta.validation.constraints.NotBlank;

public record SaveOfflineFlowRequest(
        Long groupId,
        @NotBlank String path,
        @NotBlank String content,
        @NotBlank String contentHash,
        long fileUpdatedAt
) {
}
