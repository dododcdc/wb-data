package com.wbdata.offline.dto;

public record OfflineDependentItemResponse(
        Long groupId,
        String groupName,
        String flowId,
        String path
) {
}
