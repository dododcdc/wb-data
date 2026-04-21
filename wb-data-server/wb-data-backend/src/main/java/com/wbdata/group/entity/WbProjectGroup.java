package com.wbdata.group.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("wb_project_group")
public class WbProjectGroup {

    @TableId(type = IdType.AUTO)
    private Long id;

    private String name;

    private String description;

    private String status = "active";

    private Long createdBy;

    private Long updatedBy;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;
}
