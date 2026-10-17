package com.wbdata.offline.execution.dto;

import java.time.Instant;

public record OfflineExecutionResponse(
        String executionId,
        String mode,
        String flowPath,
        String sourceRevision,
        String status,
        Instant createdAt
) {
}
