package com.wbdata.offline.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("wb_offline_recent_flow")
public class WbOfflineRecentFlow {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long userId;

    private Long groupId;

    private String flowPath;

    private LocalDateTime accessedAt;
}
