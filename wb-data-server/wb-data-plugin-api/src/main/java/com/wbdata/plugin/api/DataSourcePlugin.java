package com.wbdata.plugin.api;

public interface DataSourcePlugin {

    DataSourcePluginDescriptor descriptor();

    default boolean testConnection(DataSourceConnectionInfo connectionInfo) {
        return testConnectionDetailed(connectionInfo).success();
    }

    default ConnectionTestResult testConnectionDetailed(DataSourceConnectionInfo connectionInfo) {
        return testConnection(connectionInfo)
                ? ConnectionTestResult.success("连接成功")
                : ConnectionTestResult.failure("连接失败，请检查地址、端口和认证信息");
    }

    java.util.List<String> getDatabases(DataSourceConnectionInfo connectionInfo);

    default PageResult<TableSummary> getTables(DataSourceConnectionInfo connectionInfo, String databaseName) {
        return getTables(connectionInfo, databaseName, null, 1, 200);
    }

    PageResult<TableSummary> getTables(DataSourceConnectionInfo connectionInfo, String databaseName, String keyword, int page, int size);

    java.util.List<ColumnMetadata> getColumns(DataSourceConnectionInfo connectionInfo, String databaseName, String tableName);

    QueryResult executeQuery(QueryRequest request);

    /**
     * 获取数据源支持的方言元数据（关键字、类型、函数等）。
     * 提供给前端智能提示使用。
     */
    default DialectMetadata getDialectMetadata() {
        return new DialectMetadata(null, null, null);
    }
}
