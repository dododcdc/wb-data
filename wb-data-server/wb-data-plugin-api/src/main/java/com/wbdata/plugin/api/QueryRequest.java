package com.wbdata.plugin.api;

public record QueryRequest(
    DataSourceConnectionInfo connectionInfo,
    String sql,
    Integer rowLimit,
    Integer timeoutSeconds
) {
    public QueryRequest(DataSourceConnectionInfo connectionInfo, String sql, Integer rowLimit) {
        this(connectionInfo, sql, rowLimit, null);
    }
}
