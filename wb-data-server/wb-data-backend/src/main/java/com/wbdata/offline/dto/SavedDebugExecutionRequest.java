package com.wbdata.offline.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.List;
import java.util.Map;
import java.time.LocalDateTime;

public record SavedDebugExecutionRequest(
        Long groupId,
        @NotBlank String flowPath,
        @NotNull List<String> selectedTaskIds,
        @NotBlank String mode,
        Map<String, String> parameterOverrides,
        LocalDateTime plannedTime
) {
    public SavedDebugExecutionRequest(Long groupId,
                                      String flowPath,
                                      List<String> selectedTaskIds,
                                      String mode) {
        this(groupId, flowPath, selectedTaskIds, mode, Map.of(), null);
    }

    public SavedDebugExecutionRequest(Long groupId,
                                      String flowPath,
                                      List<String> selectedTaskIds,
                                      String mode,
                                      Map<String, String> parameterOverrides) {
        this(groupId, flowPath, selectedTaskIds, mode, parameterOverrides, null);
    }
}
