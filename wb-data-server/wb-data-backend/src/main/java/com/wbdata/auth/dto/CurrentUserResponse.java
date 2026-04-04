package com.wbdata.auth.dto;

public record CurrentUserResponse(
        Long id,
        String username,
        String displayName,
        String systemRole
) {
}
