package com.wbdata.offline.dto;

import java.time.Instant;

public record OfflineExecutionTaskRun(
        String taskId,
        String status,
        Instant startDate,
        Instant endDate
) {
}
