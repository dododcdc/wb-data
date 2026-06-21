package com.wbdata.operations.dto;

import java.time.Instant;

public record OperationsExecutionListItem(
        String id,
        String namespace,
        String flowId,
        String branch,
        String status,
        Instant createdAt,
        Instant startDate,
        Instant endDate,
        Long durationMs,
        boolean rerunnable
) {
}
