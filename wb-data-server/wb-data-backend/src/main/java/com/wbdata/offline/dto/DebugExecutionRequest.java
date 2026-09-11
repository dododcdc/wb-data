package com.wbdata.offline.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.List;
import java.util.Map;
import java.time.LocalDateTime;

public record DebugExecutionRequest(
        Long groupId,
        @NotBlank String flowPath,
        @NotBlank String content,
        @NotNull List<String> selectedTaskIds,
        @NotBlank String mode,
        Map<String, String> parameterOverrides,
        LocalDateTime plannedTime
) {
    public DebugExecutionRequest(Long groupId,
                                 String flowPath,
                                 String content,
                                 List<String> selectedTaskIds,
                                 String mode) {
        this(groupId, flowPath, content, selectedTaskIds, mode, Map.of(), null);
    }

    public DebugExecutionRequest(Long groupId,
                                 String flowPath,
                                 String content,
                                 List<String> selectedTaskIds,
                                 String mode,
                                 Map<String, String> parameterOverrides) {
        this(groupId, flowPath, content, selectedTaskIds, mode, parameterOverrides, null);
    }
}
