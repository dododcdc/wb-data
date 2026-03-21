package com.wbdata.datasource.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

import java.util.Map;

@Data
@Schema(description = "数据源更新请求")
public class DataSourceUpdateDTO {

    @NotBlank(message = "数据源名称不能为空")
    @Schema(description = "数据源名称", requiredMode = Schema.RequiredMode.REQUIRED)
    private String name;

    @NotBlank(message = "数据源类型不能为空")
    @Schema(description = "数据源类型", requiredMode = Schema.RequiredMode.REQUIRED)
    private String type;

    @Schema(description = "数据源描述")
    private String description;

    @NotBlank(message = "主机地址不能为空")
    @Schema(description = "主机名/IP", requiredMode = Schema.RequiredMode.REQUIRED)
    private String host;

    @NotNull(message = "Port不能为空")
    @Min(value = 1, message = "端口必须在 1-65535 之间")
    @Max(value = 65535, message = "端口必须在 1-65535 之间")
    @Schema(description = "端口", requiredMode = Schema.RequiredMode.REQUIRED)
    private Integer port;

    @NotBlank(message = "默认数据库不能为空")
    @Schema(description = "数据库名", requiredMode = Schema.RequiredMode.REQUIRED)
    private String databaseName;

    @NotBlank(message = "用户名不能为空")
    @Schema(description = "用户名", requiredMode = Schema.RequiredMode.REQUIRED)
    private String username;

    @Schema(description = "密码")
    private String password;

    @Schema(description = "额外连接参数")
    private Map<String, Object> connectionParams;

    @Schema(description = "负责人")
    private String owner;
}
