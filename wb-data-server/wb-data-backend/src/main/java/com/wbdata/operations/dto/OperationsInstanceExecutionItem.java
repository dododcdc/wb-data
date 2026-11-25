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
        boolean rerun,
        String rerunType,
        Integer retryAttempt,
        boolean partialRerun,
        Integer rerunSelectedTaskCount,
        Integer rerunTotalTaskCount
) {
    public OperationsInstanceExecutionItem(
            String id,
            String status,
            Instant plannedAt,
            Instant createdAt,
            Instant startDate,
            Instant endDate,
            Long durationMs,
            boolean rerun,
            String rerunType,
            Integer retryAttempt
    ) {
        this(id, status, plannedAt, createdAt, startDate, endDate, durationMs,
                rerun, rerunType, retryAttempt, false, null, null);
    }

    public OperationsInstanceExecutionItem(
            String id,
            String status,
            Instant plannedAt,
            Instant createdAt,
            Instant startDate,
            Instant endDate,
            Long durationMs,
            boolean rerun
    ) {
        this(id, status, plannedAt, createdAt, startDate, endDate, durationMs,
                rerun, rerun ? "MANUAL" : "NONE", null, false, null, null);
    }
}
