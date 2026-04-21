package com.wbdata.offline.dto;

import java.time.Instant;

public record OfflineRepoStatusResponse(
        Long groupId,
        String repoPath,
        boolean exists,
        boolean gitInitialized,
        boolean dirty,
        boolean ahead,
        String branch,
        String headCommitId,
        String headCommitMessage,
        Instant headCommitAt
) {
}
