package com.wbdata.group.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("wb_user_group_preference")
public class WbUserGroupPreference {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long userId;

    private Long groupId;

    private Long defaultDatasourceId;

    private LocalDateTime lastAccessedAt;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;
}
