package com.wbdata.offline.dto;

import java.time.Instant;

public record OfflineExecutionListItem(
        String executionId,
        String flowPath,
        String displayName,
        Long requestedBy,
        String mode,
        String status,
        String triggerType,
        Instant startDate,
        Instant endDate,
        Long durationMs,
        String sourceRevision
) {
}
