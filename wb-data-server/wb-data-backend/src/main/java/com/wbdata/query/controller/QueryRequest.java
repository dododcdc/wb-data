package com.wbdata.query.controller;

import jakarta.validation.constraints.NotBlank;

public record QueryRequest(
    @NotBlank(message = "SQL 不能为空")
    String sql,
    String database
) {}
