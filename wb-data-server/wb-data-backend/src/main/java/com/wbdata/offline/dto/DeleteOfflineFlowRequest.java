package com.wbdata.offline.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record DeleteOfflineFlowRequest(
        @NotNull Long groupId,
        @NotBlank String path
) {
}
