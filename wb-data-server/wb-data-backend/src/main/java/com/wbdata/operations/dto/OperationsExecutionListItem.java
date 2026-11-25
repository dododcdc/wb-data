package com.wbdata.operations.dto;

import java.time.Instant;

public record OperationsExecutionListItem(
        String id,
        String namespace,
        String flowId,
        String branch,
        String status,
        Instant plannedAt,
        Instant createdAt,
        Instant startDate,
        Instant endDate,
        Long durationMs,
        boolean rerunnable,
        boolean stoppable,
        boolean rerun,
        String rerunType,
        Integer retryAttempt,
        boolean partialRerun,
        Integer rerunSelectedTaskCount,
        Integer rerunTotalTaskCount,
        boolean markableSuccess
) {
    public OperationsExecutionListItem(
            String id,
            String namespace,
            String flowId,
            String branch,
            String status,
            Instant plannedAt,
            Instant createdAt,
            Instant startDate,
            Instant endDate,
            Long durationMs,
            boolean rerunnable,
            boolean stoppable,
            boolean rerun,
            String rerunType,
            Integer retryAttempt,
            boolean partialRerun,
            Integer rerunSelectedTaskCount,
            Integer rerunTotalTaskCount
    ) {
        this(id, namespace, flowId, branch, status, plannedAt, createdAt, startDate, endDate,
                durationMs, rerunnable, stoppable, rerun, rerunType, retryAttempt,
                partialRerun, rerunSelectedTaskCount, rerunTotalTaskCount, false);
    }

    public OperationsExecutionListItem(
            String id,
            String namespace,
            String flowId,
            String branch,
            String status,
            Instant plannedAt,
            Instant createdAt,
            Instant startDate,
            Instant endDate,
            Long durationMs,
            boolean rerunnable,
            boolean stoppable,
            boolean rerun,
            String rerunType,
            Integer retryAttempt
    ) {
        this(id, namespace, flowId, branch, status, plannedAt, createdAt, startDate, endDate,
                durationMs, rerunnable, stoppable, rerun, rerunType, retryAttempt,
                false, null, null, false);
    }

    public OperationsExecutionListItem(
            String id,
            String namespace,
            String flowId,
            String branch,
            String status,
            Instant plannedAt,
            Instant createdAt,
            Instant startDate,
            Instant endDate,
            Long durationMs,
            boolean rerunnable,
            boolean stoppable,
            boolean rerun
    ) {
        this(id, namespace, flowId, branch, status, plannedAt, createdAt, startDate, endDate,
                durationMs, rerunnable, stoppable, rerun, rerun ? "MANUAL" : "NONE", null,
                false, null, null, false);
    }
}
