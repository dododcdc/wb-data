package com.wbdata.offline.dto;

import java.util.List;

public record OfflineFlowStageResponse(
        String stageId,
        boolean parallel,
        List<OfflineFlowNodeResponse> nodes
) {
}
