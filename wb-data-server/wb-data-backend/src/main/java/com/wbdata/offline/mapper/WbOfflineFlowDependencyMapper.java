package com.wbdata.offline.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.wbdata.offline.entity.WbOfflineFlowDependency;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

public interface WbOfflineFlowDependencyMapper extends BaseMapper<WbOfflineFlowDependency> {

    @Select("""
            SELECT id, flow_index_id, downstream_group_id, downstream_flow_id,
                   upstream_group_id, upstream_flow_id
            FROM wb_offline_flow_dependency
            WHERE flow_index_id = #{flowIndexId}
            ORDER BY id ASC
            """)
    List<WbOfflineFlowDependency> findByFlowIndexId(@Param("flowIndexId") Long flowIndexId);

    @Select("""
            <script>
            SELECT id, flow_index_id, downstream_group_id, downstream_flow_id,
                   upstream_group_id, upstream_flow_id
            FROM wb_offline_flow_dependency
            WHERE flow_index_id IN
            <foreach collection="flowIndexIds" item="fid" open="(" separator="," close=")">
                #{fid}
            </foreach>
            ORDER BY id ASC
            </script>
            """)
    List<WbOfflineFlowDependency> findByFlowIndexIds(@Param("flowIndexIds") List<Long> flowIndexIds);

    @Select("""
            SELECT id, flow_index_id, downstream_group_id, downstream_flow_id,
                   upstream_group_id, upstream_flow_id
            FROM wb_offline_flow_dependency
            WHERE upstream_group_id = #{upstreamGroupId} AND upstream_flow_id = #{upstreamFlowId}
            """)
    List<WbOfflineFlowDependency> findByUpstream(@Param("upstreamGroupId") Long upstreamGroupId,
                                                 @Param("upstreamFlowId") String upstreamFlowId);

    @Select("""
            <script>
            SELECT id, flow_index_id, downstream_group_id, downstream_flow_id,
                   upstream_group_id, upstream_flow_id
            FROM wb_offline_flow_dependency
            WHERE upstream_group_id = #{upstreamGroupId} AND upstream_flow_id IN
            <foreach collection="upstreamFlowIds" item="fid" open="(" separator="," close=")">
                #{fid}
            </foreach>
            </script>
            """)
    List<WbOfflineFlowDependency> findByUpstreamGroupAndFlowIds(@Param("upstreamGroupId") Long upstreamGroupId,
                                                                @Param("upstreamFlowIds") List<String> upstreamFlowIds);

    @Select("""
            <script>
            SELECT id, flow_index_id, downstream_group_id, downstream_flow_id,
                   upstream_group_id, upstream_flow_id
            FROM wb_offline_flow_dependency
            WHERE downstream_group_id = #{downstreamGroupId} AND downstream_flow_id IN
            <foreach collection="downstreamFlowIds" item="fid" open="(" separator="," close=")">
                #{fid}
            </foreach>
            ORDER BY id ASC
            </script>
            """)
    List<WbOfflineFlowDependency> findByDownstreamGroupAndFlowIds(@Param("downstreamGroupId") Long downstreamGroupId,
                                                                  @Param("downstreamFlowIds") List<String> downstreamFlowIds);

    @Delete("""
            DELETE FROM wb_offline_flow_dependency
            WHERE flow_index_id = #{flowIndexId}
            """)
    int deleteByFlowIndexId(@Param("flowIndexId") Long flowIndexId);
}
