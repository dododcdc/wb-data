package com.wbdata.datasource.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.wbdata.datasource.dto.DataSourceSearchQuery;
import com.wbdata.datasource.entity.DataSource;
import org.apache.ibatis.annotations.Param;

public interface DataSourceMapper extends BaseMapper<DataSource> {

    /**
     * 分页查询数据源列表 (XML实现)
     */
    IPage<DataSource> selectDataSourceList(Page<DataSource> page, @Param("query") DataSourceSearchQuery query);
}
