package com.wbdata.plugin.api;

import java.util.Collections;
import java.util.Map;

public record ConnectionTestRequest(
        Long dataSourceId,
        String type,
        String host,
        Integer port,
        String databaseName,
        String username,
        String password,
        Map<String, Object> connectionParams
) {
    public ConnectionTestRequest {
        connectionParams = connectionParams == null ? Collections.emptyMap() : Collections.unmodifiableMap(connectionParams);
    }
}
