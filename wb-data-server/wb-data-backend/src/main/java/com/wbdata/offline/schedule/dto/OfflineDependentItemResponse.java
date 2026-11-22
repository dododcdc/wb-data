package com.wbdata.offline.schedule.dto;

import com.wbdata.offline.enums.OfflineSchedulePeriod;

public record OfflineDependentItemResponse(
        Long groupId,
        String groupName,
        String flowId,
        String path,
        OfflineSchedulePeriod period,
        String cron
) {
}
