package com.wbdata.auth.service;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.wbdata.auth.dto.CurrentUserResponse;
import com.wbdata.auth.dto.LoginResponse;
import com.wbdata.user.entity.WbUser;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

@Service
public class AuthTokenService {
    private static final Duration TOKEN_TTL = Duration.ofHours(12);

    private final Cache<String, AuthSession> sessions = Caffeine.newBuilder()
            .expireAfterWrite(TOKEN_TTL)
            .maximumSize(10_000)
            .build();

    public LoginResponse issueToken(WbUser user) {
        String token = UUID.randomUUID().toString();
        Instant expiresAt = Instant.now().plus(TOKEN_TTL);
        AuthSession session = new AuthSession(
                user.getId(),
                user.getUsername(),
                user.getDisplayName(),
                user.getSystemRole(),
                expiresAt
        );
        sessions.put(token, session);
        return new LoginResponse(token, "Bearer", expiresAt, session.toCurrentUserResponse());
    }

    public CurrentUserResponse getCurrentUser(String authorizationHeader) {
        return requireSession(authorizationHeader).toCurrentUserResponse();
    }

    public AuthSession resolveToken(String token) {
        if (token == null || token.isBlank()) {
            return null;
        }
        return sessions.getIfPresent(token);
    }

    public void invalidateToken(String token) {
        if (token != null) {
            sessions.invalidate(token);
        }
    }

    private AuthSession requireSession(String authorizationHeader) {
        if (authorizationHeader == null || authorizationHeader.isBlank()) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "缺少 Authorization 请求头");
        }

        String prefix = "Bearer ";
        if (!authorizationHeader.startsWith(prefix)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Authorization 格式错误，应为 Bearer token");
        }

        String token = authorizationHeader.substring(prefix.length()).trim();
        if (token.isBlank()) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "访问令牌不能为空");
        }

        AuthSession session = resolveToken(token);
        if (session == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "登录状态已失效，请重新登录");
        }

        return session;
    }
}
