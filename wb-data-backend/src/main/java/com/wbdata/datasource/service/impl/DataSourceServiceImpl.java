package com.wbdata.datasource.service.impl;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.wbdata.datasource.dto.DataSourceSearchQuery;
import com.wbdata.datasource.dto.TestConnectionRequest;
import com.wbdata.datasource.entity.DataSource;
import com.wbdata.datasource.mapper.DataSourceMapper;
import com.wbdata.datasource.service.DataSourceService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DataSourceServiceImpl extends ServiceImpl<DataSourceMapper, DataSource> implements DataSourceService {

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
    }

    @Override
    public boolean testConnection(TestConnectionRequest request) {
        if ("MYSQL".equalsIgnoreCase(request.getType())) {
            return com.wbdata.datasource.utils.DataSourceUtil.testMySQLConnection(
                    request.getHost(), request.getPort(), request.getDatabaseName(),
                    request.getUsername(), request.getPassword(), request.getConnectionParams());
        }
        // TODO: Implement other DB types
        return false;
    }

    @Override
    public boolean testConnection(Long id) {
        DataSource ds = this.getById(id);
        if (ds == null)
            return false;

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
