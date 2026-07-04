package com.wbdata.operations.dto;

import java.time.Instant;

public record OperationsExecutionQuery(
        String branch,
        String flowId,
        String status,
        Instant from,
        Instant to,
        Integer page,
        Integer pageSize
) {
}
