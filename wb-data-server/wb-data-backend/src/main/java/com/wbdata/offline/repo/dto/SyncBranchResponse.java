package com.wbdata.offline.repo.dto;

public record SyncBranchResponse(
        String sourceBranch,
        String targetBranch,
        boolean upToDate,
        String headCommitId,
        String message
) {
}
