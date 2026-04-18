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
        Map<String, NodePosition> layout
) {
}
