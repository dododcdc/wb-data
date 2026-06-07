package com.wbdata.operations.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("wb_operation_execution_action")
public class WbOperationExecutionAction {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long groupId;

    private String actionType;

    private String originalExecutionId;

    private String newExecutionId;

    private String namespace;

    private String flowId;

    private Long requestedBy;

    private LocalDateTime requestedAt;
}
