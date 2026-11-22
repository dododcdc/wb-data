package com.wbdata.plugin.api;

public interface DataSourcePlugin {

    DataSourcePluginDescriptor descriptor();

    default boolean testConnection(DataSourceConnectionInfo connectionInfo) {
        return testConnectionDetailed(connectionInfo).success();
    }

    ConnectionTestResult testConnectionDetailed(DataSourceConnectionInfo connectionInfo);

    default void validateConnectionInfo(DataSourceConnectionInfo connectionInfo) {
    }

    java.util.List<String> getDatabases(DataSourceConnectionInfo connectionInfo);

    default PageResult<TableSummary> getTables(DataSourceConnectionInfo connectionInfo, String databaseName) {
        return getTables(connectionInfo, databaseName, null, 1, 200);
    }

    PageResult<TableSummary> getTables(DataSourceConnectionInfo connectionInfo, String databaseName, String keyword, int page, int size);

    java.util.List<ColumnMetadata> getColumns(DataSourceConnectionInfo connectionInfo, String databaseName, String tableName);

    default TableDetail getTableDetail(DataSourceConnectionInfo connectionInfo, String databaseName, String tableName) {
        return new TableDetail(getColumns(connectionInfo, databaseName, tableName), java.util.List.of(), false);
    }

    QueryResult executeQuery(QueryRequest request);

    default QueryStreamSummary streamQuery(QueryRequest request, QueryRowHandler rowHandler) {
        QueryResult result = executeQuery(request);
        java.util.List<ColumnMetadata> columns = result.columns() == null ? java.util.List.of() : result.columns();
        try {
            rowHandler.onColumns(columns);
            java.util.List<java.util.Map<String, Object>> rows = result.rows() == null
                    ? java.util.List.of()
                    : result.rows();
            for (java.util.Map<String, Object> row : rows) {
                java.util.List<Object> values = new java.util.ArrayList<>(columns.size());
                for (ColumnMetadata column : columns) {
                    values.add(row.get(column.name()));
                }
                rowHandler.onRow(values);
            }
            return new QueryStreamSummary(rows.size(), result.truncated(), result.executionTimeMs());
        } catch (Exception e) {
            throw new DataSourceException("流式读取查询结果失败: " + e.getMessage(), e);
        }
    }

    void executeStatements(DataSourceConnectionInfo connectionInfo, java.util.List<String> statements,
                           java.util.Map<String, String> parameters, int timeoutSeconds);

    /**
     * 获取数据源支持的方言元数据（关键字、类型、函数等）。
     * 提供给前端智能提示使用。
     */
    default DialectMetadata getDialectMetadata() {
        return new DialectMetadata(null, null, null);
    }
}
