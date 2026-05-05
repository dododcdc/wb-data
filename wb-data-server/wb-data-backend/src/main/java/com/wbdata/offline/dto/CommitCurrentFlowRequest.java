package com.wbdata.offline.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record CommitCurrentFlowRequest(
        @NotNull Long groupId,
        @NotBlank String flowPath,
        String message
) {
}
