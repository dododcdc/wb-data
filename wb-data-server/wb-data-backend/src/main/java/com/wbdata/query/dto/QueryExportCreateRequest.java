package com.wbdata.query.dto;

import com.wbdata.query.enums.ExportFormat;
import jakarta.validation.constraints.NotBlank;

public record QueryExportCreateRequest(
        @NotBlank(message = "SQL 不能为空")
        String sql,
        String database,
        ExportFormat format
) {}
