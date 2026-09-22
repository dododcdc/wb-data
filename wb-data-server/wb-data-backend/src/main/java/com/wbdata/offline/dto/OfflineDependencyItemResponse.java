package com.wbdata.offline.dto;

import com.wbdata.offline.enums.OfflineCrossGroupDependency;
import com.wbdata.offline.enums.OfflineSchedulePeriod;

public record OfflineDependencyItemResponse(
        Long groupId,
        String groupName,
        String flowId,
        String path,
        OfflineSchedulePeriod period,
        OfflineCrossGroupDependency crossGroupDependency,
        String cron,
        String timezone,
        boolean enabled
) {
}
