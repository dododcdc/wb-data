package com.wbdata.ownership.dto;

public record GroupAssetHandoverResponse(
        Long groupId,
        Long fromUserId,
        Long targetOwnerUserId,
        String targetOwnerName,
        int dataSourcesTransferred,
        int parameterGroupsTransferred,
        int offlineFlowsTransferred,
        int totalTransferred
) {
}
