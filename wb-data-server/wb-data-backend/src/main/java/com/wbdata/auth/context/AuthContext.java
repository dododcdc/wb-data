package com.wbdata.auth.context;

import com.wbdata.auth.service.AuthSession;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

public final class AuthContext {
    private static final ThreadLocal<AuthSession> HOLDER = new ThreadLocal<>();

    private AuthContext() {
    }

    public static void set(AuthSession session) {
        HOLDER.set(session);
    }

    public static AuthSession current() {
        return HOLDER.get();
    }

    public static AuthSession require() {
        AuthSession session = HOLDER.get();
        if (session == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "未登录或登录已过期");
        }
        return session;
    }

    public static AuthSession requireSystemAdmin() {
        AuthSession session = require();
        if (!session.isSystemAdmin()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "需要系统管理员权限");
        }
        return session;
    }

    public static void clear() {
        HOLDER.remove();
    }
}
