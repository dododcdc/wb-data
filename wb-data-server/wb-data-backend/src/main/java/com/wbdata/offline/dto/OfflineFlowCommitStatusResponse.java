package com.wbdata.offline.dto;

public record OfflineFlowCommitStatusResponse(
        Long groupId,
        String flowPath,
        boolean dirty
) {
}
