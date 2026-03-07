package com.wbdata.plugin.api;

public interface DataSourcePlugin {

    DataSourcePluginDescriptor descriptor();


    boolean testConnection(ConnectionTestRequest request);

    java.util.List<TableMetadata> getTables(ConnectionTestRequest request);

    QueryResult executeQuery(QueryRequest request);
}
