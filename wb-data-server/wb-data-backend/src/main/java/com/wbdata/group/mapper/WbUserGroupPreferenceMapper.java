package com.wbdata.group.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.wbdata.group.entity.WbUserGroupPreference;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDateTime;

public interface WbUserGroupPreferenceMapper extends BaseMapper<WbUserGroupPreference> {
    @Insert("INSERT INTO wb_user_group_preference (user_id, group_id, last_accessed_at) "
            + "VALUES (#{userId}, #{groupId}, #{accessedAt}) "
            + "ON DUPLICATE KEY UPDATE last_accessed_at = #{accessedAt}")
    int recordSelection(@Param("userId") Long userId, @Param("groupId") Long groupId,
                        @Param("accessedAt") LocalDateTime accessedAt);
}
