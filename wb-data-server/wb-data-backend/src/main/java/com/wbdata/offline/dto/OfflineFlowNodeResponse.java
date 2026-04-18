package com.wbdata.offline.dto;

public record OfflineFlowNodeResponse(
        String taskId,
        String kind,
        String scriptPath,
        String scriptContent,
        Long dataSourceId,
        String dataSourceType
) {
}
