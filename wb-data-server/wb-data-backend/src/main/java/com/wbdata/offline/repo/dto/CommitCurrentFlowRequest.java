package com.wbdata.offline.repo.dto;

import jakarta.validation.constraints.NotBlank;

public record CommitCurrentFlowRequest(
        Long groupId,
        @NotBlank String flowPath,
        String message
) {
}
