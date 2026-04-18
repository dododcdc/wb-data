package com.wbdata.offline.dto;

import java.time.Instant;

public record OfflineExecutionLogEntry(
        Instant timestamp,
        String taskId,
        String level,
        String message
) {
}
