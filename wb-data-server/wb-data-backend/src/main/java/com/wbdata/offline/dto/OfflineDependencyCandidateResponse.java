package com.wbdata.offline.dto;

import com.wbdata.offline.enums.OfflineCrossGroupDependency;
import com.wbdata.offline.enums.OfflineSchedulePeriod;

public record OfflineDependencyCandidateResponse(
        Long groupId,
        String groupName,
        String flowId,
        String path,
        boolean hasSchedule,
        OfflineSchedulePeriod period,
        OfflineCrossGroupDependency crossGroupDependency,
        String cron,
        String timezone,
        boolean enabled
) {
}
