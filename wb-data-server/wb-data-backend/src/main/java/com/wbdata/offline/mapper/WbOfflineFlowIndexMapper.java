package com.wbdata.offline.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.wbdata.offline.entity.WbOfflineFlowIndex;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

public interface WbOfflineFlowIndexMapper extends BaseMapper<WbOfflineFlowIndex> {

    @Select("""
            SELECT id, group_id, flow_path, flow_id, parse_status,
                   has_schedule, schedule_enabled, schedule_period, schedule_cron, schedule_timezone,
                   cross_group_dependency, failure_policy, dependency_count,
                   file_mtime_ms, file_size, updated_at
            FROM wb_offline_flow_index
            WHERE group_id = #{groupId}
            """)
    List<WbOfflineFlowIndex> findByGroup(@Param("groupId") Long groupId);

    @Select("""
            SELECT id, group_id, flow_path, flow_id, parse_status,
                   has_schedule, schedule_enabled, schedule_period, schedule_cron, schedule_timezone,
                   cross_group_dependency, failure_policy, dependency_count,
                   file_mtime_ms, file_size, updated_at
            FROM wb_offline_flow_index
            WHERE group_id = #{groupId} AND flow_path = #{flowPath}
            """)
    WbOfflineFlowIndex findByGroupAndPath(@Param("groupId") Long groupId,
                                          @Param("flowPath") String flowPath);

    @Select("""
            SELECT id, group_id, flow_path, flow_id, parse_status,
                   has_schedule, schedule_enabled, schedule_period, schedule_cron, schedule_timezone,
                   cross_group_dependency, failure_policy, dependency_count,
                   file_mtime_ms, file_size, updated_at
            FROM wb_offline_flow_index
            WHERE group_id = #{groupId} AND flow_id = #{flowId}
            """)
    List<WbOfflineFlowIndex> findByGroupAndFlowId(@Param("groupId") Long groupId,
                                                  @Param("flowId") String flowId);

    @Select("""
            <script>
            SELECT id, group_id, flow_path, flow_id, parse_status,
                   has_schedule, schedule_enabled, schedule_period, schedule_cron, schedule_timezone,
                   cross_group_dependency, failure_policy, dependency_count,
                   file_mtime_ms, file_size, updated_at
            FROM wb_offline_flow_index
            WHERE group_id IN
            <foreach collection="groupIds" item="gid" open="(" separator="," close=")">
                #{gid}
            </foreach>
            </script>
            """)
    List<WbOfflineFlowIndex> findByGroupIds(@Param("groupIds") List<Long> groupIds);

    @Select("""
            <script>
            SELECT id, group_id, flow_path, flow_id, parse_status,
                   has_schedule, schedule_enabled, schedule_period, schedule_cron, schedule_timezone,
                   cross_group_dependency, failure_policy, dependency_count,
                   file_mtime_ms, file_size, updated_at
            FROM wb_offline_flow_index
            WHERE group_id = #{groupId} AND flow_id IN
            <foreach collection="flowIds" item="fid" open="(" separator="," close=")">
                #{fid}
            </foreach>
            </script>
            """)
    List<WbOfflineFlowIndex> findByGroupAndFlowIds(@Param("groupId") Long groupId,
                                                   @Param("flowIds") List<String> flowIds);

    @Select("""
            <script>
            SELECT id, group_id, flow_path, flow_id, parse_status,
                   has_schedule, schedule_enabled, schedule_period, schedule_cron, schedule_timezone,
                   cross_group_dependency, failure_policy, dependency_count,
                   file_mtime_ms, file_size, updated_at
            FROM wb_offline_flow_index
            WHERE id IN
            <foreach collection="ids" item="id" open="(" separator="," close=")">
                #{id}
            </foreach>
            </script>
            """)
    List<WbOfflineFlowIndex> findByIds(@Param("ids") List<Long> ids);

    @Select("""
            SELECT id, group_id, flow_path, flow_id, parse_status,
                   has_schedule, schedule_enabled, schedule_period, schedule_cron, schedule_timezone,
                   cross_group_dependency, failure_policy, dependency_count,
                   file_mtime_ms, file_size, updated_at
            FROM wb_offline_flow_index
            WHERE group_id = #{groupId} AND LOCATE(#{prefix}, flow_path) = 1
            """)
    List<WbOfflineFlowIndex> findByGroupAndPathPrefix(@Param("groupId") Long groupId,
                                                      @Param("prefix") String prefix);

    @Select("""
            SELECT COUNT(*)
            FROM wb_offline_flow_index
            WHERE parse_status <> 'OK'
            """)
    long countInvalidFlows();

    @Select("""
            SELECT COUNT(*)
            FROM (
                SELECT group_id, flow_id
                FROM wb_offline_flow_index
                WHERE parse_status = 'OK' AND flow_id IS NOT NULL
                GROUP BY group_id, flow_id
                HAVING COUNT(*) > 1
            ) dup
            """)
    long countDuplicateFlowIds();

    @Delete("""
            DELETE FROM wb_offline_flow_index
            WHERE group_id = #{groupId} AND flow_path = #{flowPath}
            """)
    int deleteByGroupAndPath(@Param("groupId") Long groupId,
                             @Param("flowPath") String flowPath);

    @Delete("""
            DELETE FROM wb_offline_flow_index
            WHERE group_id = #{groupId} AND LOCATE(#{prefix}, flow_path) = 1
            """)
    int deleteByGroupAndPathPrefix(@Param("groupId") Long groupId,
                                   @Param("prefix") String prefix);

    @Delete("""
            DELETE FROM wb_offline_flow_index
            WHERE group_id = #{groupId}
            """)
    int deleteByGroup(@Param("groupId") Long groupId);
}
