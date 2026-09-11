package com.wbdata.offline.service;

record OfflineFlowNode(
        String taskId,
        String kind,
        String scriptPath,
        Long dataSourceId,
        String dataSourceType,
        String transferConfigPath
) {
}
