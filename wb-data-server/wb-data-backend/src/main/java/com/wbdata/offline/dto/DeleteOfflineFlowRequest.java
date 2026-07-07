package com.wbdata.offline.dto;

import jakarta.validation.constraints.NotBlank;

public record DeleteOfflineFlowRequest(
        Long groupId,
        @NotBlank String path
) {
}
