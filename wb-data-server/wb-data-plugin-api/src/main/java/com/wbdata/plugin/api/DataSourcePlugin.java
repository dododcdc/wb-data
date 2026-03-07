package com.wbdata.plugin.api;

public interface DataSourcePlugin {

    DataSourcePluginDescriptor descriptor();

    boolean testConnection(ConnectionTestRequest request);
}
