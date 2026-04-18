package com.wbdata.offline.dto;

public record OfflineFlowContentResponse(
        Long groupId,
        String path,
        String content,
        String contentHash,
        long fileUpdatedAt
) {
}
