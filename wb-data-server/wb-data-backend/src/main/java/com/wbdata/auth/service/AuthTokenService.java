package com.wbdata.auth.service;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.wbdata.auth.dto.CurrentUserResponse;
import com.wbdata.auth.dto.LoginResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

@Service
public class AuthTokenService {
    private static final Duration TOKEN_TTL = Duration.ofHours(12);

    private final AuthUserAccountPort userAccountPort;
    private final Clock clock;
    private final Cache<String, CachedSession> sessions = Caffeine.newBuilder()
            .expireAfterWrite(TOKEN_TTL)
            .maximumSize(10_000)
            .build();

    @Autowired
    public AuthTokenService(AuthUserAccountPort userAccountPort) {
        this(userAccountPort, Clock.systemUTC());
    }

    AuthTokenService(AuthUserAccountPort userAccountPort, Clock clock) {
        this.userAccountPort = userAccountPort;
        this.clock = clock;
    }

    public LoginResponse issueToken(AuthUserAccountPort.AuthUserAccount user) {
        String token = UUID.randomUUID().toString();
        Instant expiresAt = Instant.now(clock).plus(TOKEN_TTL);
        AuthSession session = new AuthSession(
                user.id(),
                user.username(),
                user.displayName(),
                user.systemRole(),
                expiresAt
        );
        sessions.put(token, new CachedSession(session, user.authVersion()));
        return new LoginResponse(token, "Bearer", expiresAt, session.toCurrentUserResponse());
    }

    public CurrentUserResponse getCurrentUser(String authorizationHeader) {
        return requireSession(authorizationHeader).toCurrentUserResponse();
    }

    public AuthSession resolveToken(String token) {
        if (token == null || token.isBlank()) {
            return null;
        }
        CachedSession cached = sessions.getIfPresent(token);
        if (cached == null) {
            return null;
        }
        if (!cached.session().expiresAt().isAfter(Instant.now(clock))) {
            sessions.invalidate(token);
            return null;
        }
        AuthUserAccountPort.AuthUserAccount user = userAccountPort.findById(cached.session().id()).orElse(null);
        if (user == null || !"ACTIVE".equalsIgnoreCase(user.status())
                || user.authVersion() != cached.authVersion()) {
            sessions.invalidate(token);
            return null;
        }
        AuthSession currentSession = new AuthSession(
                user.id(),
                user.username(),
                user.displayName(),
                user.systemRole(),
                cached.session().expiresAt()
        );
        if (!currentSession.equals(cached.session())) {
            sessions.put(token, new CachedSession(currentSession, user.authVersion()));
        }
        return currentSession;
    }

    private record CachedSession(AuthSession session, long authVersion) {}

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
