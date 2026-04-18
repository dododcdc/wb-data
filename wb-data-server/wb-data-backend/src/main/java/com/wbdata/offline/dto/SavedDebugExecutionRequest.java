package com.wbdata.offline.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.List;

public record SavedDebugExecutionRequest(
        @NotNull Long groupId,
        @NotBlank String flowPath,
        @NotNull List<String> selectedTaskIds,
        @NotBlank String mode
) {
}
