package com.wbdata.auth.service;

import com.wbdata.auth.dto.CurrentUserResponse;
import com.wbdata.auth.enums.SystemRole;

import java.time.Instant;

public record AuthSession(
        Long id,
        String username,
        String displayName,
        String systemRole,
        Instant expiresAt
) {
    public boolean isSystemAdmin() {
        return SystemRole.SYSTEM_ADMIN.name().equals(systemRole);
    }

    public CurrentUserResponse toCurrentUserResponse() {
        return new CurrentUserResponse(id, username, displayName, systemRole);
    }
}
