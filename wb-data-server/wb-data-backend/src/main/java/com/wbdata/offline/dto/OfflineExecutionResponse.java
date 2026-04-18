package com.wbdata.offline.dto;

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
