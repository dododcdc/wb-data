package com.wbdata.parameter.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.wbdata.parameter.entity.WbParameterGroup;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

@Mapper
public interface WbParameterGroupMapper extends BaseMapper<WbParameterGroup> {

    @Select("SELECT COUNT(*) FROM wb_parameter_group WHERE group_id = #{groupId} AND owner_user_id = #{ownerUserId}")
    long countByGroupAndOwnerUserId(@Param("groupId") Long groupId, @Param("ownerUserId") Long ownerUserId);

    @Select("SELECT group_id AS groupId, COUNT(*) AS cnt FROM wb_parameter_group " +
            "WHERE owner_user_id = #{ownerUserId} AND group_id IS NOT NULL GROUP BY group_id")
    List<GroupCountRow> countByOwnerAcrossGroups(@Param("ownerUserId") Long ownerUserId);

    record GroupCountRow(Long groupId, Long cnt) {
    }
}
