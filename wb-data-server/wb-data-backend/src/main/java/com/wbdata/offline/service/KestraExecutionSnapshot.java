package com.wbdata.offline.service;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public record KestraExecutionSnapshot(
        String id,
        String namespace,
        String flowId,
        String status,
        Instant plannedAt,
        Instant createdAt,
        Instant startDate,
        Instant endDate,
        List<KestraTaskRunSnapshot> taskRuns,
        Map<String, String> inputs,
        Map<String, String> labels
) {
}
