package com.wbdata.plugin.api;

public interface DataSourcePlugin {

    DataSourcePluginDescriptor descriptor();

    boolean testConnection(ConnectionTestRequest request);

    java.util.List<String> getDatabases(ConnectionTestRequest request);

    default PageResult<TableSummary> getTables(ConnectionTestRequest request, String databaseName) {
        return getTables(request, databaseName, null, 1, 200);
    }

    PageResult<TableSummary> getTables(ConnectionTestRequest request, String databaseName, String keyword, int page, int size);

    java.util.List<ColumnMetadata> getColumns(ConnectionTestRequest request, String databaseName, String tableName);

    QueryResult executeQuery(QueryRequest request);

    /**
     * 获取数据源支持的方言元数据（关键字、类型、函数等）。
     * 提供给前端智能提示使用。
     */
    default DialectMetadata getDialectMetadata() {
        return new DialectMetadata(null, null, null);
    }
}
