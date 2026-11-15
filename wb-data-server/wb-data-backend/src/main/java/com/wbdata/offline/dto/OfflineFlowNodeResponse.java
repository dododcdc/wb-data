package com.wbdata.offline.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.wbdata.offline.transfer.dto.TransferConfig;

import java.util.Map;

public record OfflineFlowNodeResponse(
        String taskId,
        String kind,
        String scriptPath,
        String scriptContent,
        Long dataSourceId,
        String dataSourceType,
        TransferConfig transfer,
        @JsonInclude(JsonInclude.Include.NON_EMPTY) Map<String, String> hiveConf
) {
    public OfflineFlowNodeResponse(String taskId, String kind, String scriptPath, String scriptContent,
                                   Long dataSourceId, String dataSourceType) {
        this(taskId, kind, scriptPath, scriptContent, dataSourceId, dataSourceType, null, null);
    }

    public OfflineFlowNodeResponse(String taskId, String kind, String scriptPath, String scriptContent,
                                   Long dataSourceId, String dataSourceType, TransferConfig transfer) {
        this(taskId, kind, scriptPath, scriptContent, dataSourceId, dataSourceType, transfer, null);
    }
}
