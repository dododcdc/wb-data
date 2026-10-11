package com.wbdata.operations.dto;

import java.time.Instant;

public record OperationsInstanceExecutionItem(
        String id,
        String status,
        Instant plannedAt,
        Instant createdAt,
        Instant startDate,
        Instant endDate,
        Long durationMs,
        boolean rerun
) {
}
