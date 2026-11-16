package com.wbdata.offline.repo.dto;

import jakarta.validation.constraints.NotBlank;

public record PushCurrentFlowRequest(
        Long groupId,
        @NotBlank String flowPath
) {
}
