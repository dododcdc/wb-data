package com.wbdata.git.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("wb_git_sync_config")
public class WbGitSyncConfig {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long groupId;

    private Long gitConfigId;

    private String branch;

    private Boolean enabled;

    private LocalDateTime lastSyncAt;

    private String lastSyncStatus;

    private String lastSyncMessage;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;
}
