package com.wbdata.offline.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;

import java.util.List;
import java.util.Map;

public record DebugDocumentExecutionRequest(
        @NotNull Long groupId,
        @NotBlank String flowPath,
        String documentHash,
        long documentUpdatedAt,
        @NotEmpty List<@Valid SaveOfflineFlowStageRequest> stages,
        @NotNull List<@Valid SaveOfflineFlowEdgeRequest> edges,
        Map<String, NodePosition> layout,
        @NotNull List<String> selectedTaskIds,
        @NotBlank String mode
) {
}
