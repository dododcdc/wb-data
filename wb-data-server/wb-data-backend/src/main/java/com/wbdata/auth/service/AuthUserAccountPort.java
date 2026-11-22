package com.wbdata.auth.service;

import java.time.LocalDateTime;
import java.util.Optional;

/**
 * auth 域对用户账号认证信息的窄端口，由 user 包的适配器实现。
 */
public interface AuthUserAccountPort {

    record AuthUserAccount(
            Long id,
            String username,
            String displayName,
            String passwordHash,
            String systemRole,
            String status,
            long authVersion
    ) {}

    Optional<AuthUserAccount> findByUsername(String username);

    Optional<AuthUserAccount> findById(Long userId);

    void updateLastLoginAt(Long userId, LocalDateTime lastLoginAt);
}
