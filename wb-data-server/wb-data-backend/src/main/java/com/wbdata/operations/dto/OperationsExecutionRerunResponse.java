package com.wbdata.operations.dto;

import java.time.Instant;

public record OperationsExecutionRerunResponse(
        String originalExecutionId,
        String newExecutionId,
        String namespace,
        String flowId,
        String status,
        Instant createdAt
) {
}
