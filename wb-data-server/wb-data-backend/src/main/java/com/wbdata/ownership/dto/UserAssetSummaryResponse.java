package com.wbdata.ownership.dto;

import java.util.List;

public record UserAssetSummaryResponse(
        Long userId,
        long totalDataSources,
        long totalParameterGroups,
        long totalOfflineFlows,
        long totalCount,
        List<GroupMemberAssetSummaryResponse> groups
) {
}
