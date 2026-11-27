package com.wbdata.group.dto;

public record AssetOwnerSummaryResponse(
        Long userId,
        String username,
        String displayName,
        String status,
        long count
) {
}
