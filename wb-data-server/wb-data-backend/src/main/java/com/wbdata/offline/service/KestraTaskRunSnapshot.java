package com.wbdata.offline.service;

import java.time.Instant;

public record KestraTaskRunSnapshot(
        String taskId,
        String status,
        Instant startDate,
        Instant endDate
) {
}
