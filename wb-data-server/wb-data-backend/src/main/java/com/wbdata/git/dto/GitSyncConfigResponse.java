package com.wbdata.git.dto;

import java.time.LocalDateTime;

public record GitSyncConfigResponse(
        Long id,
        Long groupId,
        String branch,
        String namespace,
        String syncFlowId,
        boolean enabled,
        LocalDateTime lastSyncAt,
        String lastSyncStatus,
        String lastSyncMessage
) {
}
