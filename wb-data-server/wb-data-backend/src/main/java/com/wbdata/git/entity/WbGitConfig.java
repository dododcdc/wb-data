package com.wbdata.git.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("wb_git_config")
public class WbGitConfig {

    @TableId(type = IdType.AUTO)
    private Long id;

    /** 所属项目组 ID */
    private Long projectGroupId;

    /** github | gitlab | gitea */
    private String provider;

    private String username;

    private String token;

    /** 代码托管平台地址，GitHub 固定 https://github.com */
    private String baseUrl;

    private Long updatedBy;

    private LocalDateTime updatedAt;
}
