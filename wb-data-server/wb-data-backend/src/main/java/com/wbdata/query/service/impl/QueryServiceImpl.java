package com.wbdata.query.service.impl;

import com.wbdata.datasource.entity.DataSource;
import com.wbdata.datasource.plugin.DataSourcePluginRegistry;
import com.wbdata.datasource.service.DataSourceService;
import com.wbdata.plugin.api.QueryRequest;
import com.wbdata.plugin.api.QueryResult;
import com.wbdata.query.service.QueryService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.Collections;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@Slf4j
@Service
@RequiredArgsConstructor
public class QueryServiceImpl implements QueryService {

    private final DataSourceService dataSourceService;
    private final DataSourcePluginRegistry pluginRegistry;
    
    // Use virtual threads for query execution
    private final ExecutorService queryExecutor = Executors.newVirtualThreadPerTaskExecutor();

    @Override
    public QueryResult executeQuery(Long dataSourceId, String sql) {
        DataSource ds = dataSourceService.getById(dataSourceId);
        if (ds == null) {
            return new QueryResult(Collections.emptyList(), Collections.emptyList(), 0, "DataSource not found");
        }

        try {
            // Execute in a virtual thread and wait for result
            return CompletableFuture.supplyAsync(() -> {
                return pluginRegistry.getPlugin(ds.getType())
                        .map(plugin -> plugin.executeQuery(new QueryRequest(
                                ds.getId(),
                                ds.getType(),
                                ds.getHost(),
                                ds.getPort(),
                                ds.getDatabaseName(),
                                ds.getUsername(),
                                ds.getPassword(),
                                ds.getConnectionParams(),
                                sql
                        )))
                        .orElse(new QueryResult(Collections.emptyList(), Collections.emptyList(), 0, "Plugin not found for type: " + ds.getType()));
            }, queryExecutor).get();
        } catch (Exception e) {
            log.error("Failed to execute query", e);
            return new QueryResult(Collections.emptyList(), Collections.emptyList(), 0, "Execution error: " + e.getMessage());
        }
    }
}
