package com.wbdata.offline.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;

import java.util.List;
import java.util.Map;

public record SaveOfflineFlowDocumentRequest(
        Long groupId,
        @NotBlank String path,
        String documentHash,
        long documentUpdatedAt,
        List<@Valid SaveOfflineFlowStageRequest> stages,
        List<SaveOfflineFlowEdgeRequest> edges,
        Map<String, NodePosition> layout,
        @Valid OfflineFlowSchedule schedule,
        @Valid FlowParameterBindingRequest parameterBinding,
        List<@Valid FlowParameterBindingRequest> parameterBindings,
        String runtimeTimezone
) {
    public SaveOfflineFlowDocumentRequest(
            Long groupId,
            String path,
            String documentHash,
            long documentUpdatedAt,
            List<SaveOfflineFlowStageRequest> stages,
            List<SaveOfflineFlowEdgeRequest> edges,
            Map<String, NodePosition> layout,
            OfflineFlowSchedule schedule,
            FlowParameterBindingRequest parameterBinding,
            String runtimeTimezone
    ) {
        this(groupId, path, documentHash, documentUpdatedAt, stages, edges, layout, schedule, parameterBinding, null, runtimeTimezone);
    }

    public SaveOfflineFlowDocumentRequest(
            Long groupId,
            String path,
            String documentHash,
            long documentUpdatedAt,
            List<SaveOfflineFlowStageRequest> stages,
            List<SaveOfflineFlowEdgeRequest> edges,
            Map<String, NodePosition> layout,
            OfflineFlowSchedule schedule,
            FlowParameterBindingRequest parameterBinding
    ) {
        this(groupId, path, documentHash, documentUpdatedAt, stages, edges, layout, schedule, parameterBinding, null, null);
    }
}
