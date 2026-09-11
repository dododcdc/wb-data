package com.wbdata.offline.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;

import java.util.List;
import java.util.Map;
import java.time.LocalDateTime;

public record DebugDocumentExecutionRequest(
        Long groupId,
        @NotBlank String flowPath,
        String documentHash,
        long documentUpdatedAt,
        @NotEmpty List<@Valid SaveOfflineFlowStageRequest> stages,
        @NotNull List<@Valid SaveOfflineFlowEdgeRequest> edges,
        Map<String, NodePosition> layout,
        @NotNull List<String> selectedTaskIds,
        @NotBlank String mode,
        Map<String, String> parameterOverrides,
        LocalDateTime plannedTime
) {
    public DebugDocumentExecutionRequest(Long groupId,
                                         String flowPath,
                                         String documentHash,
                                         long documentUpdatedAt,
                                         List<SaveOfflineFlowStageRequest> stages,
                                         List<SaveOfflineFlowEdgeRequest> edges,
                                         Map<String, NodePosition> layout,
                                         List<String> selectedTaskIds,
                                         String mode) {
        this(groupId, flowPath, documentHash, documentUpdatedAt, stages, edges, layout,
                selectedTaskIds, mode, Map.of(), null);
    }

    public DebugDocumentExecutionRequest(Long groupId,
                                         String flowPath,
                                         String documentHash,
                                         long documentUpdatedAt,
                                         List<SaveOfflineFlowStageRequest> stages,
                                         List<SaveOfflineFlowEdgeRequest> edges,
                                         Map<String, NodePosition> layout,
                                         List<String> selectedTaskIds,
                                         String mode,
                                         Map<String, String> parameterOverrides) {
        this(groupId, flowPath, documentHash, documentUpdatedAt, stages, edges, layout,
                selectedTaskIds, mode, parameterOverrides, null);
    }
}
