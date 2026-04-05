package com.wbdata.query.service.impl;

import com.wbdata.datasource.entity.DataSource;
import com.wbdata.datasource.plugin.DataSourcePluginRegistry;
import com.wbdata.datasource.service.DataSourceService;
import com.wbdata.plugin.api.ColumnMetadata;
import com.wbdata.plugin.api.DataSourceConnectionInfo;
import com.wbdata.plugin.api.PageResult;
import com.wbdata.plugin.api.TableSummary;
import com.wbdata.query.service.MetadataService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.Collections;
import java.util.List;

@Service
@RequiredArgsConstructor
public class MetadataServiceImpl implements MetadataService {

    private final DataSourceService dataSourceService;
    private final DataSourcePluginRegistry pluginRegistry;

    @Override
    public List<String> getDatabases(Long dataSourceId) {
        DataSource ds = dataSourceService.getById(dataSourceId);
        if (ds == null) {
            return Collections.emptyList();
        }

        return pluginRegistry.getPlugin(ds.getType())
                .map(plugin -> plugin.getDatabases(buildConnectionInfo(ds)))
                .orElse(Collections.emptyList());
    }

    @Override
    public PageResult<TableSummary> getTables(Long dataSourceId, String databaseName, String keyword, int page, int size) {
        DataSource ds = dataSourceService.getById(dataSourceId);
        if (ds == null) {
            return new PageResult<>(Collections.emptyList(), 0, page, size);
        }

        return pluginRegistry.getPlugin(ds.getType())
                .map(plugin -> plugin.getTables(buildConnectionInfo(ds), databaseName, keyword, page, size))
                .orElse(new PageResult<>(Collections.emptyList(), 0, page, size));
    }

    @Override
    public List<ColumnMetadata> getColumns(Long dataSourceId, String databaseName, String tableName) {
        DataSource ds = dataSourceService.getById(dataSourceId);
        if (ds == null) {
            return Collections.emptyList();
        }

        return pluginRegistry.getPlugin(ds.getType())
                .map(plugin -> plugin.getColumns(buildConnectionInfo(ds), databaseName, tableName))
                .orElse(Collections.emptyList());
    }

    @Override
    public com.wbdata.plugin.api.DialectMetadata getDialectMetadata(Long dataSourceId) {
        DataSource ds = dataSourceService.getById(dataSourceId);
        if (ds == null) {
            return new com.wbdata.plugin.api.DialectMetadata(null, null, null);
        }

        return pluginRegistry.getPlugin(ds.getType())
                .map(com.wbdata.plugin.api.DataSourcePlugin::getDialectMetadata)
                .orElseGet(() -> new com.wbdata.plugin.api.DialectMetadata(null, null, null));
    }

    private DataSourceConnectionInfo buildConnectionInfo(DataSource ds) {
        return new DataSourceConnectionInfo(
                ds.getId(),
                ds.getType(),
                ds.getHost(),
                ds.getPort(),
                ds.getDatabaseName(),
                ds.getUsername(),
                ds.getPassword(),
                ds.getConnectionParams()
        );
    }
}
