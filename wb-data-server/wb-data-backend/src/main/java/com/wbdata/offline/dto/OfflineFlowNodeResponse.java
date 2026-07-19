package com.wbdata.offline.dto;

import com.wbdata.offline.transfer.dto.TransferConfig;

public record OfflineFlowNodeResponse(
        String taskId,
        String kind,
        String scriptPath,
        String scriptContent,
        Long dataSourceId,
        String dataSourceType,
        TransferConfig transfer
) {
    public OfflineFlowNodeResponse(String taskId, String kind, String scriptPath, String scriptContent,
                                   Long dataSourceId, String dataSourceType) {
        this(taskId, kind, scriptPath, scriptContent, dataSourceId, dataSourceType, null);
    }
}
