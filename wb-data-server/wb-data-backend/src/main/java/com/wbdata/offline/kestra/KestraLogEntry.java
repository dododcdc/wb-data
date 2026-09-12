package com.wbdata.offline.kestra;

import java.time.Instant;

public record KestraLogEntry(
        Instant timestamp,
        String taskId,
        String level,
        String message
) {
}
