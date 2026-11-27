package com.wbdata.datasource.dto;

import com.wbdata.datasource.entity.DataSource;
import com.wbdata.group.dto.GroupOwnerInfo;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.Map;

@Data
@Schema(description = "数据源出网视图（不含密码等敏感字段）")
public class DataSourceResponse {

    @Schema(description = "数据源 ID")
    private Long id;

    @Schema(description = "数据源名称")
    private String name;

    @Schema(description = "数据源类型")
    private String type;

    @Schema(description = "数据源描述")
    private String description;

    @Schema(description = "主机名/IP")
    private String host;

    @Schema(description = "端口")
    private Integer port;

    @Schema(description = "数据库名")
    private String databaseName;

    @Schema(description = "用户名")
    private String username;

    @Schema(description = "额外连接参数")
    private Map<String, Object> connectionParams;

    @Schema(description = "状态：ENABLED/DISABLED")
    private String status;

    @Schema(description = "负责人展示名（兼容字段）")
    private String owner;

    @Schema(description = "负责人用户 ID")
    private Long ownerUserId;

    @Schema(description = "负责人展示名")
    private String ownerName;

    @Schema(description = "负责人用户名")
    private String ownerUsername;

    @Schema(description = "负责人状态：ACTIVE/DISABLED/LEFT_GROUP/UNKNOWN")
    private String ownerStatus;

    @Schema(description = "创建时间")
    private LocalDateTime createdAt;

    @Schema(description = "更新时间")
    private LocalDateTime updatedAt;

    public static DataSourceResponse from(DataSource entity) {
        return from(entity, null);
    }

    public static DataSourceResponse from(DataSource entity, GroupOwnerInfo ownerInfo) {
        DataSourceResponse response = new DataSourceResponse();
        response.setId(entity.getId());
        response.setName(entity.getName());
        response.setType(entity.getType());
        response.setDescription(entity.getDescription());
        response.setHost(entity.getHost());
        response.setPort(entity.getPort());
        response.setDatabaseName(entity.getDatabaseName());
        response.setUsername(entity.getUsername());
        response.setConnectionParams(entity.getConnectionParams());
        response.setStatus(entity.getStatus());
        response.setOwnerUserId(entity.getOwnerUserId());
        if (ownerInfo != null) {
            String effectiveName = ownerInfo.effectiveName();
            response.setOwnerName(effectiveName);
            response.setOwnerUsername(ownerInfo.username());
            response.setOwnerStatus(ownerInfo.status());
            response.setOwner(effectiveName);
        } else {
            response.setOwnerName(entity.getOwner());
            response.setOwner(entity.getOwner());
            response.setOwnerStatus(entity.getOwnerUserId() != null ? "UNKNOWN" : null);
        }
        response.setCreatedAt(entity.getCreatedAt());
        response.setUpdatedAt(entity.getUpdatedAt());
        return response;
    }
}
