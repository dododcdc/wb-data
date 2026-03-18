package com.wbdata.plugin.api;

public record QueryRequest(
    DataSourceConnectionInfo connectionInfo,
    String sql
) {}
