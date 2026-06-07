package com.wbdata.operations.dto;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public record OperationsExecutionDetailResponse(
        String id,
        String namespace,
        String flowId,
        String branch,
        String status,
        Instant createdAt,
        Instant startDate,
        Instant endDate,
        Long durationMs,
        String failureSummary,
        boolean rerunnable,
        List<OperationsExecutionTaskRun> taskRuns,
        Map<String, String> inputs,
        Map<String, String> labels
) {
}
