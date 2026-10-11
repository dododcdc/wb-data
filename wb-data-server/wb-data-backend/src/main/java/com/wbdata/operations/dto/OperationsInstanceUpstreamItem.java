package com.wbdata.operations.dto;

public record OperationsInstanceUpstreamItem(
        Long groupId,
        String groupName,
        String flowId,
        String namespace,
        String scheduleKey,
        String state,
        boolean satisfied,
        boolean accessible,
        String executionId
) {
}
