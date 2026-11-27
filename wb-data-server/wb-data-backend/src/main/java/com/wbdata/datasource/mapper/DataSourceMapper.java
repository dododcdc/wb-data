package com.wbdata.datasource.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.wbdata.datasource.dto.DataSourceSearchQuery;
import com.wbdata.datasource.entity.DataSource;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

public interface DataSourceMapper extends BaseMapper<DataSource> {

    /**
     * 分页查询数据源列表 (XML实现)
     */
    IPage<DataSource> selectDataSourceList(Page<DataSource> page, @Param("query") DataSourceSearchQuery query);

    @Select("SELECT owner_user_id AS ownerUserId, COUNT(*) AS cnt FROM datasource " +
            "WHERE group_id = #{groupId} AND owner_user_id IS NOT NULL GROUP BY owner_user_id")
    List<OwnerCountRow> countByOwnerUserId(@Param("groupId") Long groupId);

    @Select("SELECT COUNT(*) FROM datasource WHERE group_id = #{groupId} AND owner_user_id = #{ownerUserId}")
    long countByGroupAndOwnerUserId(@Param("groupId") Long groupId, @Param("ownerUserId") Long ownerUserId);

    @Select("SELECT group_id AS groupId, COUNT(*) AS cnt FROM datasource " +
            "WHERE owner_user_id = #{ownerUserId} AND group_id IS NOT NULL GROUP BY group_id")
    List<GroupCountRow> countByOwnerAcrossGroups(@Param("ownerUserId") Long ownerUserId);

    record OwnerCountRow(Long ownerUserId, Long cnt) {
    }

    record GroupCountRow(Long groupId, Long cnt) {
    }
}
