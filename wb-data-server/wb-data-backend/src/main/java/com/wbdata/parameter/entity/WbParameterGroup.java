package com.wbdata.parameter.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("wb_parameter_group")
public class WbParameterGroup {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long groupId;
    private String code;
    private String name;
    private String description;
    private Integer version;
    private Integer revision;
    private String status;
    private Long createdBy;
    private Long updatedBy;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
