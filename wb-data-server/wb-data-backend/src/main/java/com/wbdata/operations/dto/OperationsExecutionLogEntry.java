package com.wbdata.operations.dto;

import java.time.Instant;

public record OperationsExecutionLogEntry(
        Instant timestamp,
        String taskId,
        String level,
        String message
) {
}
