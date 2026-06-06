package com.wbdata.git.dto;

import java.time.LocalDateTime;

public record TriggerGitSyncResponse(
        Long id,
        String executionId,
        String status,
        LocalDateTime triggeredAt
) {
}
