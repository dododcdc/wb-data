package com.wbdata.datasource.service;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.service.IService;
import com.wbdata.datasource.dto.DataSourceSearchQuery;
import com.wbdata.datasource.dto.TestConnectionRequest;
import com.wbdata.datasource.entity.DataSource;

public interface DataSourceService extends IService<DataSource> {

    IPage<DataSource> getDataSourcePage(DataSourceSearchQuery query);

    void updateStatus(Long id, String status);

    boolean testConnection(TestConnectionRequest request);

    boolean testConnection(Long id);
}
