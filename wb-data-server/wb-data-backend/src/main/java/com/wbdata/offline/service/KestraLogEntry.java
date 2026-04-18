package com.wbdata.offline.service;

import java.time.Instant;

public record KestraLogEntry(
        Instant timestamp,
        String taskId,
        String level,
        String message
) {
}
