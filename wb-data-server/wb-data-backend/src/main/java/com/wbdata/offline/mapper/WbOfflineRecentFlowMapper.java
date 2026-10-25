package com.wbdata.offline.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.wbdata.offline.entity.WbOfflineRecentFlow;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;

public interface WbOfflineRecentFlowMapper extends BaseMapper<WbOfflineRecentFlow> {

    @Select("""
            SELECT id, user_id, group_id, flow_path, accessed_at
            FROM wb_offline_recent_flow
            WHERE user_id = #{userId} AND group_id = #{groupId}
            ORDER BY accessed_at DESC, id DESC
            """)
    List<WbOfflineRecentFlow> findByUserAndGroup(@Param("userId") Long userId,
                                                  @Param("groupId") Long groupId);

    @Select("""
            SELECT id, user_id, group_id, flow_path, accessed_at
            FROM wb_offline_recent_flow
            WHERE group_id = #{groupId}
            ORDER BY accessed_at DESC, id DESC
            """)
    List<WbOfflineRecentFlow> findByGroup(@Param("groupId") Long groupId);

    @Delete("""
            DELETE FROM wb_offline_recent_flow
            WHERE user_id = #{userId} AND group_id = #{groupId} AND flow_path = #{flowPath}
            """)
    int deleteByUserGroupAndPath(@Param("userId") Long userId,
                                 @Param("groupId") Long groupId,
                                 @Param("flowPath") String flowPath);

    @Delete("""
            DELETE FROM wb_offline_recent_flow
            WHERE group_id = #{groupId} AND flow_path = #{flowPath}
            """)
    int deleteByGroupAndPath(@Param("groupId") Long groupId,
                             @Param("flowPath") String flowPath);

    @Update("""
            UPDATE wb_offline_recent_flow
            SET flow_path = #{flowPath}
            WHERE id = #{id}
            """)
    int updateFlowPathById(@Param("id") Long id,
                           @Param("flowPath") String flowPath);
}
