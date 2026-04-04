package com.wbdata.auth.dto;

import java.time.Instant;

public record LoginResponse(
        String accessToken,
        String tokenType,
        Instant expiresAt,
        CurrentUserResponse user
) {
}
