package com.wbdata.offline.dto;

public record OfflineFlowCommitStatusResponse(
        Long groupId,
        String flowPath,
        boolean dirty,
        boolean ahead
) {
    public OfflineFlowCommitStatusResponse(Long groupId, String flowPath, boolean dirty) {
        this(groupId, flowPath, dirty, false);
    }
}
