package com.wbdata.operations.dto;

import org.springframework.lang.Nullable;

import java.time.Instant;

public record OperationsExecutionQuery(
        String branch,
        String flowId,
        String status,
        Instant from,
        Instant to,
        Integer page,
        Integer pageSize,
        @Nullable Long ownerUserId
) {
    public OperationsExecutionQuery(
            String branch,
            String flowId,
            String status,
            Instant from,
            Instant to,
            Integer page,
            Integer pageSize
    ) {
        this(branch, flowId, status, from, to, page, pageSize, null);
    }
}
