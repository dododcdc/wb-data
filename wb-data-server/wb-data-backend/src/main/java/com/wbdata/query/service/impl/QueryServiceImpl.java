package com.wbdata.query.service.impl;

import com.wbdata.datasource.entity.DataSource;
import com.wbdata.datasource.plugin.DataSourceConnectionInfoFactory;
import com.wbdata.datasource.plugin.DataSourcePluginRegistry;
import com.wbdata.datasource.service.DataSourceService;
import com.wbdata.plugin.api.QueryRequest;
import com.wbdata.plugin.api.QueryResult;
import com.wbdata.query.service.QueryService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class QueryServiceImpl implements QueryService {

    private final DataSourceService dataSourceService;
    private final DataSourcePluginRegistry pluginRegistry;
    private final DataSourceConnectionInfoFactory connectionInfoFactory;

    @Override
    public QueryResult executeQuery(Long dataSourceId, String sql, String database) {
        return executeQuery(dataSourceId, sql, database, null);
    }

    @Override
    public QueryResult executeQuery(Long dataSourceId, String sql, String database, Integer rowLimit) {
        DataSource ds = dataSourceService.getById(dataSourceId);
        if (ds == null) {
            throw new IllegalArgumentException("数据源不存在: " + dataSourceId);
        }

        return pluginRegistry.getPlugin(ds.getType())
                .map(plugin -> plugin.executeQuery(new QueryRequest(
                        connectionInfoFactory.pooled(ds, database),
                        sql,
                        rowLimit
                )))
                .orElseThrow(() -> new IllegalArgumentException("未找到对应类型的插件: " + ds.getType()));
    }
}
