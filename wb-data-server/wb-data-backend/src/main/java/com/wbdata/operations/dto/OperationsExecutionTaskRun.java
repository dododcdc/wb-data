package com.wbdata.operations.dto;

import java.time.Instant;

public record OperationsExecutionTaskRun(
        String taskId,
        String status,
        Instant startDate,
        Instant endDate,
        Long durationMs
) {
}
