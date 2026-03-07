package com.wbdata.plugin.api;

import java.util.Map;

public record QueryRequest(
    String type,
    String host,
    Integer port,
    String databaseName,
    String username,
    String password,
    Map<String, Object> connectionParams,
    String sql
) {}
