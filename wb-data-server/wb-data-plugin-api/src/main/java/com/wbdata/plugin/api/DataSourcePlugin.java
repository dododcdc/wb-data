package com.wbdata.plugin.api;

public interface DataSourcePlugin {

    DataSourcePluginDescriptor descriptor();

    boolean testConnection(DataSourceConnectionInfo connectionInfo);

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
