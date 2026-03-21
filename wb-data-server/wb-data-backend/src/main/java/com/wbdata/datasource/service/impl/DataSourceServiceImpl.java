package com.wbdata.datasource.service.impl;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.wbdata.datasource.plugin.DataSourcePluginRegistry;
import com.wbdata.datasource.dto.DataSourceSearchQuery;
import com.wbdata.datasource.dto.TestConnectionRequest;
import com.wbdata.datasource.entity.DataSource;
import com.wbdata.datasource.mapper.DataSourceMapper;
import com.wbdata.datasource.service.DataSourceService;
import com.wbdata.plugin.api.ConnectionTestResult;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@RequiredArgsConstructor
@Service
public class DataSourceServiceImpl extends ServiceImpl<DataSourceMapper, DataSource> implements DataSourceService {

    private final DataSourcePluginRegistry pluginRegistry;
    private final com.wbdata.datasource.plugin.DataSourceConnectionPoolManager poolManager;

    @Override
    public IPage<DataSource> getDataSourcePage(DataSourceSearchQuery query) {
        Page<DataSource> page = new Page<>(query.getPage(), query.getSize());
        return this.baseMapper.selectDataSourceList(page, query);
    }

    @Override
    @Transactional
    public void updateStatus(Long id, String status) {
        DataSource ds = new DataSource();
        ds.setId(id);
        ds.setStatus(status);
        this.updateById(ds);
        poolManager.invalidate(id);
    }

    @Override
    public ConnectionTestResult testConnection(TestConnectionRequest request) {
        if (request.getType() == null || request.getType().isBlank()) {
            return ConnectionTestResult.failure("请选择数据源类型");
        }

        return pluginRegistry.getPlugin(request.getType())
                .map(plugin -> plugin.testConnectionDetailed(new com.wbdata.plugin.api.DataSourceConnectionInfo(
                        null,   // testConnection always bypasses the pool
                        request.getType(),
                        request.getHost(),
                        request.getPort(),
                        request.getDatabaseName(),
                        request.getUsername(),
                        request.getPassword(),
                        request.getConnectionParams()
                )))
                .orElseGet(() -> ConnectionTestResult.failure("暂不支持的数据源类型: " + request.getType()));
    }

    @Override
    public ConnectionTestResult testConnection(Long id) {
        DataSource ds = this.getById(id);
        if (ds == null) {
            return ConnectionTestResult.failure("数据源不存在或已删除");
        }

        TestConnectionRequest request = new TestConnectionRequest();
        request.setType(ds.getType());
        request.setHost(ds.getHost());
        request.setPort(ds.getPort());
        request.setDatabaseName(ds.getDatabaseName());
        request.setUsername(ds.getUsername());
        request.setPassword(ds.getPassword());
        request.setConnectionParams(ds.getConnectionParams());
        return this.testConnection(request);
    }
}
