package com.wbdata.offline.service;

import java.util.Map;

record OfflineFlowNode(
        String taskId,
        String kind,
        String scriptPath,
        Long dataSourceId,
        String dataSourceType,
        String transferConfigPath,
        Map<String, String> hiveConf
) {
    OfflineFlowNode(String taskId,
                    String kind,
                    String scriptPath,
                    Long dataSourceId,
                    String dataSourceType,
                    String transferConfigPath) {
        this(taskId, kind, scriptPath, dataSourceId, dataSourceType, transferConfigPath, Map.of());
    }
}
