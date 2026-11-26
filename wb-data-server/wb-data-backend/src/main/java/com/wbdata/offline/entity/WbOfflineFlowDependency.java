package com.wbdata.offline.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

@Data
@TableName("wb_offline_flow_dependency")
public class WbOfflineFlowDependency {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long flowIndexId;

    private Long downstreamGroupId;

    private String downstreamFlowId;

    private Long upstreamGroupId;

    private String upstreamFlowId;
}
