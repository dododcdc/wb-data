package com.wbdata.query.dto;

import java.time.Instant;

public record QueryExportTaskResponse(
        String taskId,
        String format,
        String status,
        String fileName,
        Integer exportedRows,
        Integer rowLimit,
        boolean truncated,
        String errorMessage,
        Instant createdAt,
        Instant updatedAt
) {}
