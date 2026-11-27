package com.wbdata.offline.dto;

import com.wbdata.offline.parameter.dto.FlowParameterBindingRequest;
import com.wbdata.offline.schedule.dto.OfflineFlowDependencySettings;
import com.wbdata.offline.schedule.dto.OfflineFlowSchedule;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.lang.Nullable;

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
        String runtimeTimezone,
        OfflineFlowDependencySettings dependencyConfig,
        @Nullable Long ownerUserId
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
            List<FlowParameterBindingRequest> parameterBindings,
            String runtimeTimezone,
            OfflineFlowDependencySettings dependencyConfig
    ) {
        this(
                groupId,
                path,
                documentHash,
                documentUpdatedAt,
                stages,
                edges,
                layout,
                schedule,
                parameterBinding,
                parameterBindings,
                runtimeTimezone,
                dependencyConfig,
                null
        );
    }
}
