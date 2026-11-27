package com.wbdata.group.dto;

public record TransferOwnerResponse(
        int updatedCount,
        Long targetOwnerUserId,
        String targetOwnerName
) {
}
