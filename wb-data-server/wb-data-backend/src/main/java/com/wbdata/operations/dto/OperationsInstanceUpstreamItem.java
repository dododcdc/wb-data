package com.wbdata.operations.dto;

import java.time.Instant;

public record OperationsInstanceUpstreamItem(
        Long groupId,
        String groupName,
        String flowId,
        String namespace,
        String scheduleKey,
        String state,
        boolean satisfied,
        boolean accessible,
        String executionId,
        Instant plannedAt,
        Instant startDate,
        Instant endDate,
        Long durationMs
) {
    public OperationsInstanceUpstreamItem(Long groupId,
                                          String groupName,
                                          String flowId,
                                          String namespace,
                                          String scheduleKey,
                                          String state,
                                          boolean satisfied,
                                          boolean accessible,
                                          String executionId) {
        this(groupId, groupName, flowId, namespace, scheduleKey, state, satisfied, accessible, executionId,
                null, null, null, null);
    }
}
