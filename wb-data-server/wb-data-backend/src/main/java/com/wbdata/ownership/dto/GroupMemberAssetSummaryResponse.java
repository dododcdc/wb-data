package com.wbdata.ownership.dto;

public record GroupMemberAssetSummaryResponse(
        Long groupId,
        String groupName,
        Long userId,
        long dataSourceCount,
        long parameterGroupCount,
        long offlineFlowCount,
        long totalCount
) {
}
