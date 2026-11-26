package com.wbdata.offline.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("wb_offline_flow_index")
public class WbOfflineFlowIndex {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long groupId;

    private String flowPath;

    private String flowId;

    private String parseStatus;

    private Boolean hasSchedule;

    private Boolean scheduleEnabled;

    private String schedulePeriod;

    private String scheduleCron;

    private String scheduleTimezone;

    private String crossGroupDependency;

    private String failurePolicy;

    private Integer dependencyCount;

    private Long fileMtimeMs;

    private Long fileSize;

    private LocalDateTime updatedAt;
}
