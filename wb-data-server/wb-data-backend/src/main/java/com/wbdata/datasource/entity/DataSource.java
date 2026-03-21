package com.wbdata.datasource.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import com.fasterxml.jackson.annotation.JsonIgnore;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.Map;

@Data
@TableName(value = "datasource", autoResultMap = true)
public class DataSource {

    @TableId(type = IdType.AUTO)
    private Long id;

    private String name;

    private String type; // MYSQL, HIVE, etc.

    private String description;

    private String host;

    private Integer port;

    private String databaseName;

    private String username;

    @JsonIgnore
    private String password;

    @TableField(typeHandler = JacksonTypeHandler.class)
    private Map<String, Object> connectionParams;

    private String status; // ENABLED (启用), DISABLED (禁用)

    private String owner;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;
}
