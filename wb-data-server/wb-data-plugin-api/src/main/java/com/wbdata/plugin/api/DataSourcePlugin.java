package com.wbdata.plugin.api;

public interface DataSourcePlugin {

    DataSourcePluginDescriptor descriptor();


    boolean testConnection(ConnectionTestRequest request);

    java.util.List<String> getDatabases(ConnectionTestRequest request);

    java.util.List<TableMetadata> getTables(ConnectionTestRequest request, String databaseName);

    QueryResult executeQuery(QueryRequest request);
}
