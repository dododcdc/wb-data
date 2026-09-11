package com.wbdata.parameter.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("wb_parameter_definition")
public class WbParameterDefinition {
    @TableId(type = IdType.AUTO)
    private Long id;
    private Long parameterGroupId;
    private String parameterKey;
    private String valueSource;
    private String constantValue;
    private String timeBasis;
    private String valueFormat;
    private Integer offsetDays;
    private String description;
    private Integer sortOrder;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
