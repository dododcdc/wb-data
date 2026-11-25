package com.wbdata.offline.schedule.dto;

import com.wbdata.offline.enums.OfflineSchedulePeriod;

public record OfflineScheduleResponse(
        Long groupId,
        String path,
        String triggerId,
        String cron,
        String timezone,
        boolean enabled,
        OfflineSchedulePeriod period,
        boolean retryEnabled,
        Integer retryCount,
        Integer retryIntervalMinutes,
        String contentHash,
        long fileUpdatedAt
) {
    public OfflineScheduleResponse(
            Long groupId,
            String path,
            String triggerId,
            String cron,
            String timezone,
            boolean enabled,
            OfflineSchedulePeriod period,
            String contentHash,
            long fileUpdatedAt
    ) {
        this(groupId, path, triggerId, cron, timezone, enabled, period, false, null, null, contentHash, fileUpdatedAt);
    }
}
