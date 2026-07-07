package com.wbdata.offline.dto;

import jakarta.validation.constraints.NotBlank;

public record CommitCurrentFlowRequest(
        Long groupId,
        @NotBlank String flowPath,
        String message
) {
}
