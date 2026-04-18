package com.wbdata.offline.dto;

public record OfflineScheduleResponse(
        Long groupId,
        String path,
        String triggerId,
        String cron,
        String timezone,
        boolean enabled,
        String contentHash,
        long fileUpdatedAt
) {
}
