package com.wbdata.offline.kestra;

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
        Map<String, String> labels,
        Map<String, String> outputs,
        String originalId,
        Integer attemptNumber
) {
    public KestraExecutionSnapshot(
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
            Map<String, String> labels,
            Map<String, String> outputs
    ) {
        this(id, namespace, flowId, status, plannedAt, createdAt, startDate, endDate,
                taskRuns, inputs, labels, outputs, null, null);
    }
}
