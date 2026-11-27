package com.wbdata.group.dto;

public record GroupOwnerOptionResponse(
        Long userId,
        String username,
        String displayName,
        String role
) {
}
