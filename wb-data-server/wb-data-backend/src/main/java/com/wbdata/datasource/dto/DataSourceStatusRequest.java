package com.wbdata.datasource.dto;

import jakarta.validation.constraints.NotBlank;

public record DataSourceStatusRequest(
    @NotBlank(message = "状态不能为空")
    String status
) {}
