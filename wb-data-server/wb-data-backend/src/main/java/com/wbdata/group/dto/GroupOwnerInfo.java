package com.wbdata.group.dto;

public record GroupOwnerInfo(
        Long userId,
        String username,
        String displayName,
        String status
) {
    public String effectiveName() {
        if (displayName != null && !displayName.isBlank()) {
            return displayName.trim();
        }
        return username;
    }
}
