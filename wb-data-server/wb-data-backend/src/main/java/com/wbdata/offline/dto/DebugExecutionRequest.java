package com.wbdata.offline.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.List;

public record DebugExecutionRequest(
        @NotNull Long groupId,
        @NotBlank String flowPath,
        @NotBlank String content,
        @NotNull List<String> selectedTaskIds,
        @NotBlank String mode
) {
}
