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
        @Valid OfflineFlowSchedule schedule
) {
}
