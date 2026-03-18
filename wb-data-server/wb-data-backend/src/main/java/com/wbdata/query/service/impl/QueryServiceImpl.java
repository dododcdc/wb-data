package com.wbdata.query.service.impl;

import com.wbdata.datasource.entity.DataSource;
import com.wbdata.datasource.plugin.DataSourcePluginRegistry;
import com.wbdata.datasource.service.DataSourceService;
import com.wbdata.plugin.api.DataSourceConnectionInfo;
import com.wbdata.plugin.api.QueryRequest;
import com.wbdata.plugin.api.QueryResult;
import com.wbdata.query.service.QueryService;
import org.springframework.stereotype.Service;

@Service
public class QueryServiceImpl implements QueryService {

    private final DataSourceService dataSourceService;
    private final DataSourcePluginRegistry pluginRegistry;

    public QueryServiceImpl(DataSourceService dataSourceService, DataSourcePluginRegistry pluginRegistry) {
        this.dataSourceService = dataSourceService;
        this.pluginRegistry = pluginRegistry;
    }

    @Override
    public QueryResult executeQuery(Long dataSourceId, String sql, String database) {
        DataSource ds = dataSourceService.getById(dataSourceId);
        if (ds == null) {
            throw new IllegalArgumentException("数据源不存在: " + dataSourceId);
        }

        String dbName = database != null && !database.isEmpty() ? database : ds.getDatabaseName();

        return pluginRegistry.getPlugin(ds.getType())
                .map(plugin -> plugin.executeQuery(new QueryRequest(
                        new DataSourceConnectionInfo(
                                ds.getId(),
                                ds.getType(),
                                ds.getHost(),
                                ds.getPort(),
                                dbName,
                                ds.getUsername(),
                                ds.getPassword(),
                                ds.getConnectionParams()),
                        sql
                )))
                .orElseThrow(() -> new IllegalArgumentException("未找到对应类型的插件: " + ds.getType()));
    }
}
