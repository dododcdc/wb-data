package com.wbdata.offline.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.wbdata.offline.entity.WbOfflineRepoIndexState;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.time.LocalDateTime;
import java.util.List;

public interface WbOfflineRepoIndexStateMapper extends BaseMapper<WbOfflineRepoIndexState> {

    @Select("""
            SELECT DISTINCT group_id
            FROM wb_offline_repo_index_state
            """)
    List<Long> findAllGroupIds();

    @Select("""
            SELECT group_id, branch, synced_branch, synced_head_sha, flow_count, indexed_at
            FROM wb_offline_repo_index_state
            WHERE group_id = #{groupId} AND branch = #{branch}
            """)
    WbOfflineRepoIndexState findByGroupAndBranch(@Param("groupId") Long groupId,
                                                 @Param("branch") String branch);

    @Insert("""
            INSERT INTO wb_offline_repo_index_state
                (group_id, branch, synced_branch, synced_head_sha, flow_count, indexed_at)
            VALUES
                (#{groupId}, #{branch}, #{syncedBranch}, #{syncedHeadSha}, #{flowCount}, #{indexedAt})
            ON DUPLICATE KEY UPDATE
                synced_branch = VALUES(synced_branch),
                synced_head_sha = VALUES(synced_head_sha),
                flow_count = VALUES(flow_count),
                indexed_at = VALUES(indexed_at)
            """)
    int upsertState(WbOfflineRepoIndexState state);

    @Update("""
            UPDATE wb_offline_repo_index_state
            SET flow_count = GREATEST(0, COALESCE(flow_count, 0) + #{delta}),
                indexed_at = #{indexedAt}
            WHERE group_id = #{groupId} AND branch = #{branch}
            """)
    int adjustFlowCount(@Param("groupId") Long groupId,
                        @Param("branch") String branch,
                        @Param("delta") int delta,
                        @Param("indexedAt") LocalDateTime indexedAt);

    @Delete("""
            DELETE FROM wb_offline_repo_index_state
            WHERE group_id = #{groupId} AND branch = #{branch}
            """)
    int deleteByGroupAndBranch(@Param("groupId") Long groupId,
                               @Param("branch") String branch);
}
