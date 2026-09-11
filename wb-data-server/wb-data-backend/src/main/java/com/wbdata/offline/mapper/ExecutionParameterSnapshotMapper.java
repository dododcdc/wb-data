package com.wbdata.offline.mapper;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

public interface ExecutionParameterSnapshotMapper {

    @Insert("""
            INSERT IGNORE INTO wb_execution_parameter_snapshot(group_id, snapshot_id, snapshot_json)
            VALUES(#{groupId}, #{snapshotId}, #{snapshotJson})
            """)
    int insertIgnore(@Param("groupId") Long groupId,
                     @Param("snapshotId") String snapshotId,
                     @Param("snapshotJson") String snapshotJson);

    @Select("""
            SELECT snapshot_json
            FROM wb_execution_parameter_snapshot
            WHERE group_id = #{groupId} AND snapshot_id = #{snapshotId}
            """)
    String findJson(@Param("groupId") Long groupId,
                    @Param("snapshotId") String snapshotId);
}
