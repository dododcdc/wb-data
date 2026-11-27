package com.wbdata.offline.dto;

import com.wbdata.offline.parameter.dto.FlowParameterBindingResponse;
import com.wbdata.offline.schedule.dto.OfflineFlowDependencySettings;
import com.wbdata.offline.schedule.dto.OfflineFlowSchedule;

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
        String runtimeTimezone,
        OfflineFlowDependencySettings dependencyConfig,
        Long ownerUserId,
        String ownerName,
        String ownerUsername,
        String ownerStatus
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
            FlowParameterBindingResponse parameterBinding,
            String runtimeTimezone,
            OfflineFlowDependencySettings dependencyConfig
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
                runtimeTimezone,
                dependencyConfig,
                null,
                null,
                null,
                null
        );
    }

    public OfflineFlowDocumentResponse withOwner(
            Long nextOwnerUserId,
            String nextOwnerName,
            String nextOwnerUsername,
            String nextOwnerStatus
    ) {
        return new OfflineFlowDocumentResponse(
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
                runtimeTimezone,
                dependencyConfig,
                nextOwnerUserId,
                nextOwnerName,
                nextOwnerUsername,
                nextOwnerStatus
        );
    }
}
