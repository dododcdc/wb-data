package com.wbdata.offline.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("wb_offline_repo_index_state")
public class WbOfflineRepoIndexState {

    @TableId(type = IdType.INPUT)
    private Long groupId;

    private String branch;

    private String syncedBranch;

    private String syncedHeadSha;

    private Integer flowCount;

    private LocalDateTime indexedAt;
}
