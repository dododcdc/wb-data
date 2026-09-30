package com.wbdata.datasource.service.impl;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.wbdata.datasource.plugin.DataSourceConnectionInfoFactory;
import com.wbdata.datasource.plugin.DataSourceConnectionPoolManager;
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
    private final DataSourceConnectionPoolManager poolManager;
    private final DataSourceConnectionInfoFactory connectionInfoFactory;

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

        DataSource probe = new DataSource();
        probe.setType(request.getType());
        probe.setHost(request.getHost());
        probe.setPort(request.getPort());
        probe.setDatabaseName(request.getDatabaseName());
        probe.setUsername(request.getUsername());
        probe.setPassword(request.getPassword());
        probe.setConnectionParams(request.getConnectionParams());

        return pluginRegistry.getPlugin(request.getType())
                .map(plugin -> plugin.testConnectionDetailed(connectionInfoFactory.bypassingPool(probe)))
                .orElseGet(() -> ConnectionTestResult.failure("暂不支持的数据源类型: " + request.getType()));
    }

    @Override
    public ConnectionTestResult testConnection(Long id) {
        DataSource ds = this.getById(id);
        if (ds == null) {
            return ConnectionTestResult.failure("数据源不存在或已删除");
        }
        return pluginRegistry.getPlugin(ds.getType())
                .map(plugin -> plugin.testConnectionDetailed(connectionInfoFactory.bypassingPool(ds)))
                .orElseGet(() -> ConnectionTestResult.failure("暂不支持的数据源类型: " + ds.getType()));
    }
}
