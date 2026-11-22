package com.wbdata.query.service.impl;

import com.wbdata.datasource.entity.DataSource;
import com.wbdata.datasource.plugin.DataSourceConnectionInfoFactory;
import com.wbdata.datasource.plugin.DataSourcePluginRegistry;
import com.wbdata.datasource.service.DataSourceService;
import com.wbdata.plugin.api.DataSourcePlugin;
import com.wbdata.plugin.api.QueryRequest;
import com.wbdata.plugin.api.QueryResult;
import com.wbdata.plugin.api.QueryRowHandler;
import com.wbdata.plugin.api.QueryStreamSummary;
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
        PluginTarget target = resolvePluginTarget(dataSourceId);
        return target.plugin().executeQuery(new QueryRequest(
                connectionInfoFactory.pooled(target.dataSource(), database),
                sql,
                rowLimit));
    }

    @Override
    public QueryStreamSummary streamQuery(Long dataSourceId, String sql, String database, Integer rowLimit,
                                          QueryRowHandler rowHandler) {
        PluginTarget target = resolvePluginTarget(dataSourceId);
        return target.plugin().streamQuery(
                new QueryRequest(connectionInfoFactory.pooled(target.dataSource(), database), sql, rowLimit),
                rowHandler);
    }

    private PluginTarget resolvePluginTarget(Long dataSourceId) {
        DataSource ds = dataSourceService.getById(dataSourceId);
        if (ds == null) {
            throw new IllegalArgumentException("数据源不存在: " + dataSourceId);
        }
        DataSourcePlugin plugin = pluginRegistry.getPlugin(ds.getType())
                .orElseThrow(() -> new IllegalArgumentException("未找到对应类型的插件: " + ds.getType()));
        return new PluginTarget(ds, plugin);
    }

    private record PluginTarget(DataSource dataSource, DataSourcePlugin plugin) {
    }
}
