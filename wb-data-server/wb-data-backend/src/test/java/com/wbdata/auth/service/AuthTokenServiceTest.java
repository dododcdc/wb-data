package com.wbdata.auth.service;

import com.wbdata.auth.dto.LoginResponse;
import com.wbdata.user.entity.WbUser;
import com.wbdata.user.mapper.WbUserMapper;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class AuthTokenServiceTest {
    private final WbUserMapper userMapper = mock(WbUserMapper.class);
    private final AuthTokenService service = new AuthTokenService(userMapper);

    @Test
    void resolvesActiveAccountWithMatchingVersion() {
        WbUser user = user(1L, 3L);
        when(userMapper.selectById(1L)).thenReturn(user);
        LoginResponse login = service.issueToken(user);

        assertThat(service.getCurrentUser("Bearer " + login.accessToken()).id()).isEqualTo(1L);
        assertThat(service.resolveToken(login.accessToken()).systemRole()).isEqualTo("SYSTEM_ADMIN");
    }

    @Test
    void unknownAndEmptyTokensDoNotQueryAccounts() {
        assertThat(service.resolveToken(null)).isNull();
        assertThat(service.resolveToken(" ")).isNull();
        assertThat(service.resolveToken("unknown")).isNull();
        verifyNoInteractions(userMapper);
    }

    @Test
    void logoutInvalidatesOnlyTheSelectedToken() {
        WbUser user = user(1L, 0L);
        when(userMapper.selectById(1L)).thenReturn(user);
        String first = service.issueToken(user).accessToken();
        String second = service.issueToken(user).accessToken();

        service.invalidateToken(first);
        service.invalidateToken(first);

        assertThat(service.resolveToken(first)).isNull();
        assertThat(service.resolveToken(second)).isNotNull();
    }

    @Test
    void versionChangeRevokesEverySessionOfOnlyThatAccount() {
        WbUser firstUser = user(1L, 0L);
        WbUser otherUser = user(2L, 0L);
        when(userMapper.selectById(1L)).thenReturn(firstUser);
        when(userMapper.selectById(2L)).thenReturn(otherUser);
        String first = service.issueToken(firstUser).accessToken();
        String second = service.issueToken(firstUser).accessToken();
        String other = service.issueToken(otherUser).accessToken();

        firstUser.setAuthVersion(1L);

        assertThat(service.resolveToken(first)).isNull();
        assertThat(service.resolveToken(second)).isNull();
        assertThat(service.resolveToken(other)).isNotNull();
        assertThat(service.resolveToken(service.issueToken(firstUser).accessToken())).isNotNull();
    }

    @Test
    void disabledAndDeletedAccountsAreRejected() {
        WbUser user = user(1L, 0L);
        when(userMapper.selectById(1L)).thenReturn(user);
        String disabledToken = service.issueToken(user).accessToken();
        String deletedToken = service.issueToken(user).accessToken();

        user.setStatus("DISABLED");
        assertThat(service.resolveToken(disabledToken)).isNull();

        when(userMapper.selectById(1L)).thenReturn(null);
        assertThat(service.resolveToken(deletedToken)).isNull();
    }

    @Test
    void reenabledAccountCannotReviveUnusedOldToken() {
        WbUser user = user(1L, 0L);
        String token = service.issueToken(user).accessToken();
        WbUser reenabled = user(1L, 2L);
        when(userMapper.selectById(1L)).thenReturn(reenabled);

        assertThat(service.resolveToken(token)).isNull();
    }

    @Test
    void restoredSystemRoleCannotReviveOldAdministratorToken() {
        WbUser user = user(1L, 0L);
        String token = service.issueToken(user).accessToken();
        WbUser restoredAdmin = user(1L, 2L);
        when(userMapper.selectById(1L)).thenReturn(restoredAdmin);

        assertThat(service.resolveToken(token)).isNull();
    }

    @Test
    void tokenIssuedFromStaleLoginSnapshotAfterAccountChangeIsRejected() {
        WbUser loginSnapshot = user(1L, 0L);
        WbUser current = user(1L, 1L);
        current.setSystemRole("USER");
        when(userMapper.selectById(1L)).thenReturn(current);

        String token = service.issueToken(loginSnapshot).accessToken();

        assertThatThrownBy(() -> service.getCurrentUser("Bearer " + token))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        e -> assertThat(e.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED));
    }

    @Test
    void nonSecurityAccountChangesKeepSessionValid() {
        WbUser user = user(1L, 0L);
        when(userMapper.selectById(1L)).thenReturn(user);
        String token = service.issueToken(user).accessToken();
        user.setDisplayName("New name");

        AuthSession resolved = service.resolveToken(token);
        assertThat(resolved).isNotNull();
        assertThat(resolved.displayName()).isEqualTo("New name");
    }

    @Test
    void activeSessionExpiresAtAbsoluteDeadlineWithoutExtendingTtl() {
        AtomicReference<Instant> currentTime = new AtomicReference<>(Instant.parse("2026-11-22T00:00:00Z"));
        Clock mutableClock = new Clock() {
            @Override
            public ZoneId getZone() {
                return ZoneOffset.UTC;
            }

            @Override
            public Clock withZone(ZoneId zone) {
                return this;
            }

            @Override
            public Instant instant() {
                return currentTime.get();
            }
        };
        AuthTokenService timedService = new AuthTokenService(userMapper, mutableClock);
        WbUser user = user(1L, 0L);
        when(userMapper.selectById(1L)).thenReturn(user);

        LoginResponse login = timedService.issueToken(user);
        assertThat(login.expiresAt()).isEqualTo(Instant.parse("2026-11-22T12:00:00Z"));

        currentTime.set(currentTime.get().plus(Duration.ofHours(11)).plusSeconds(59 * 60 + 59));
        assertThat(timedService.resolveToken(login.accessToken())).isNotNull();
        verify(userMapper, times(1)).selectById(1L);

        // Even with an access 1s earlier, reaching expiresAt rejects the token without querying DB
        currentTime.set(Instant.parse("2026-11-22T12:00:00Z"));
        assertThat(timedService.resolveToken(login.accessToken())).isNull();
        assertThat(timedService.resolveToken(login.accessToken())).isNull();
        verify(userMapper, times(1)).selectById(1L);
    }

    private static WbUser user(long id, long version) {
        WbUser user = new WbUser();
        user.setId(id);
        user.setUsername("user-" + id);
        user.setDisplayName("User " + id);
        user.setSystemRole("SYSTEM_ADMIN");
        user.setStatus("ACTIVE");
        user.setAuthVersion(version);
        return user;
    }
}
