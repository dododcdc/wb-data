package com.wbdata.operations.dto;

import java.time.Instant;

public record OperationsExecutionGraphNode(
        String taskId,
        String kind,
        String dataSourceType,
        String status,
        Instant startDate,
        Instant endDate,
        Long durationMs,
        boolean hasCodeSnapshot
) {
}
