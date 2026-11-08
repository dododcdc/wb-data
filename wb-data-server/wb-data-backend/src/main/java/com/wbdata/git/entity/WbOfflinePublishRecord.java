package com.wbdata.git.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("wb_offline_publish_record")
public class WbOfflinePublishRecord {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long groupId;

    private String branch;

    private String recordType;

    private String beforeSha;

    private String afterSha;

    private Long pushedBy;

    private LocalDateTime pushedAt;

    private Boolean syncEnabledAtPush;

    private String syncExecutionId;

    private String syncStatus;

    private String syncMessage;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;
}
