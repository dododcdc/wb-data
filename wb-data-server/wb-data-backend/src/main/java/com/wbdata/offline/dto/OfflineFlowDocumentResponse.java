package com.wbdata.offline.dto;

import java.util.List;
import java.util.Map;

public record OfflineFlowDocumentResponse(
        Long groupId,
        String path,
        String flowId,
        String namespace,
        String documentHash,
        long documentUpdatedAt,
        List<OfflineFlowStageResponse> stages,
        List<OfflineFlowEdgeResponse> edges,
        Map<String, NodePosition> layout,
        OfflineFlowSchedule schedule,
        FlowParameterBindingResponse parameterBinding,
        String runtimeTimezone
) {
    public OfflineFlowDocumentResponse(
            Long groupId,
            String path,
            String flowId,
            String namespace,
            String documentHash,
            long documentUpdatedAt,
            List<OfflineFlowStageResponse> stages,
            List<OfflineFlowEdgeResponse> edges,
            Map<String, NodePosition> layout,
            OfflineFlowSchedule schedule,
            FlowParameterBindingResponse parameterBinding
    ) {
        this(
                groupId,
                path,
                flowId,
                namespace,
                documentHash,
                documentUpdatedAt,
                stages,
                edges,
                layout,
                schedule,
                parameterBinding,
                schedule != null ? schedule.timezone() : null
        );
    }
}
