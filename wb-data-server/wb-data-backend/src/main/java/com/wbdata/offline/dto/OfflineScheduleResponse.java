package com.wbdata.offline.dto;

import com.wbdata.offline.enums.OfflineSchedulePeriod;

public record OfflineScheduleResponse(
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
}
