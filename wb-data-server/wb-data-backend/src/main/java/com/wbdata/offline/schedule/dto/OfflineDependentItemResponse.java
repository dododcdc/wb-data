package com.wbdata.offline.schedule.dto;

public record OfflineDependentItemResponse(
        Long groupId,
        String groupName,
        String flowId,
        String path
) {
}
