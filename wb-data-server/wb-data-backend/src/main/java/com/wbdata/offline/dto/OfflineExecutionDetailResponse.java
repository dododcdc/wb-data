package com.wbdata.offline.dto;

import java.time.Instant;
import java.util.List;

public record OfflineExecutionDetailResponse(
        String executionId,
        String mode,
        String flowPath,
        String sourceRevision,
        String status,
        Instant createdAt,
        Instant startDate,
        Instant endDate,
        List<OfflineExecutionTaskRun> taskRuns
) {
}
