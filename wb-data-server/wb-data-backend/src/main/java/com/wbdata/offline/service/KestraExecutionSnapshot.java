package com.wbdata.offline.service;

import java.time.Instant;
import java.util.List;

public record KestraExecutionSnapshot(
        String id,
        String namespace,
        String flowId,
        String status,
        Instant createdAt,
        Instant startDate,
        Instant endDate,
        List<KestraTaskRunSnapshot> taskRuns
) {
}
