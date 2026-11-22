package com.wbdata.auth.service;

import com.wbdata.auth.dto.LoginResponse;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class AuthTokenServiceTest {
    private final AuthUserAccountPort userAccounts = mock(AuthUserAccountPort.class);
    private final AuthTokenService service = new AuthTokenService(userAccounts);

    @Test
    void resolvesActiveAccountWithMatchingVersion() {
        AuthUserAccountPort.AuthUserAccount user = user(1L, 3L);
        when(userAccounts.findById(1L)).thenReturn(Optional.of(user));
        LoginResponse login = service.issueToken(user);

        assertThat(service.getCurrentUser("Bearer " + login.accessToken()).id()).isEqualTo(1L);
        assertThat(service.resolveToken(login.accessToken()).systemRole()).isEqualTo("SYSTEM_ADMIN");
    }

    @Test
    void unknownAndEmptyTokensDoNotQueryAccounts() {
        assertThat(service.resolveToken(null)).isNull();
        assertThat(service.resolveToken(" ")).isNull();
        assertThat(service.resolveToken("unknown")).isNull();
        verifyNoInteractions(userAccounts);
    }

    @Test
    void logoutInvalidatesOnlyTheSelectedToken() {
        AuthUserAccountPort.AuthUserAccount user = user(1L, 0L);
        when(userAccounts.findById(1L)).thenReturn(Optional.of(user));
        String first = service.issueToken(user).accessToken();
        String second = service.issueToken(user).accessToken();

        service.invalidateToken(first);
        service.invalidateToken(first);

        assertThat(service.resolveToken(first)).isNull();
        assertThat(service.resolveToken(second)).isNotNull();
    }

    @Test
    void versionChangeRevokesEverySessionOfOnlyThatAccount() {
        AuthUserAccountPort.AuthUserAccount firstUser = user(1L, 0L);
        AuthUserAccountPort.AuthUserAccount otherUser = user(2L, 0L);
        when(userAccounts.findById(1L)).thenReturn(Optional.of(firstUser));
        when(userAccounts.findById(2L)).thenReturn(Optional.of(otherUser));
        String first = service.issueToken(firstUser).accessToken();
        String second = service.issueToken(firstUser).accessToken();
        String other = service.issueToken(otherUser).accessToken();

        AuthUserAccountPort.AuthUserAccount updatedFirst = user(1L, 1L);
        when(userAccounts.findById(1L)).thenReturn(Optional.of(updatedFirst));

        assertThat(service.resolveToken(first)).isNull();
        assertThat(service.resolveToken(second)).isNull();
        assertThat(service.resolveToken(other)).isNotNull();
        assertThat(service.resolveToken(service.issueToken(updatedFirst).accessToken())).isNotNull();
    }

    @Test
    void disabledAndDeletedAccountsAreRejected() {
        AuthUserAccountPort.AuthUserAccount user = user(1L, 0L);
        when(userAccounts.findById(1L)).thenReturn(Optional.of(user));
        String disabledToken = service.issueToken(user).accessToken();
        String deletedToken = service.issueToken(user).accessToken();

        when(userAccounts.findById(1L)).thenReturn(Optional.of(
                new AuthUserAccountPort.AuthUserAccount(1L, "user-1", "User 1", "hash", "SYSTEM_ADMIN", "DISABLED", 0L)));
        assertThat(service.resolveToken(disabledToken)).isNull();

        when(userAccounts.findById(1L)).thenReturn(Optional.empty());
        assertThat(service.resolveToken(deletedToken)).isNull();
    }

    @Test
    void reenabledAccountCannotReviveUnusedOldToken() {
        AuthUserAccountPort.AuthUserAccount user = user(1L, 0L);
        String token = service.issueToken(user).accessToken();
        AuthUserAccountPort.AuthUserAccount reenabled = user(1L, 2L);
        when(userAccounts.findById(1L)).thenReturn(Optional.of(reenabled));

        assertThat(service.resolveToken(token)).isNull();
    }

    @Test
    void restoredSystemRoleCannotReviveOldAdministratorToken() {
        AuthUserAccountPort.AuthUserAccount user = user(1L, 0L);
        String token = service.issueToken(user).accessToken();
        AuthUserAccountPort.AuthUserAccount restoredAdmin = user(1L, 2L);
        when(userAccounts.findById(1L)).thenReturn(Optional.of(restoredAdmin));

        assertThat(service.resolveToken(token)).isNull();
    }

    @Test
    void tokenIssuedFromStaleLoginSnapshotAfterAccountChangeIsRejected() {
        AuthUserAccountPort.AuthUserAccount loginSnapshot = user(1L, 0L);
        AuthUserAccountPort.AuthUserAccount current = new AuthUserAccountPort.AuthUserAccount(
                1L, "user-1", "User 1", "hash", "USER", "ACTIVE", 1L);
        when(userAccounts.findById(1L)).thenReturn(Optional.of(current));

        String token = service.issueToken(loginSnapshot).accessToken();

        assertThatThrownBy(() -> service.getCurrentUser("Bearer " + token))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        e -> assertThat(e.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED));
    }

    @Test
    void nonSecurityAccountChangesKeepSessionValid() {
        AuthUserAccountPort.AuthUserAccount user = user(1L, 0L);
        when(userAccounts.findById(1L)).thenReturn(Optional.of(user));
        String token = service.issueToken(user).accessToken();
        when(userAccounts.findById(1L)).thenReturn(Optional.of(
                new AuthUserAccountPort.AuthUserAccount(1L, "user-1", "New name", "hash", "SYSTEM_ADMIN", "ACTIVE", 0L)));

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
        AuthTokenService timedService = new AuthTokenService(userAccounts, mutableClock);
        AuthUserAccountPort.AuthUserAccount user = user(1L, 0L);
        when(userAccounts.findById(1L)).thenReturn(Optional.of(user));

        LoginResponse login = timedService.issueToken(user);
        assertThat(login.expiresAt()).isEqualTo(Instant.parse("2026-11-22T12:00:00Z"));

        currentTime.set(currentTime.get().plus(Duration.ofHours(11)).plusSeconds(59 * 60 + 59));
        assertThat(timedService.resolveToken(login.accessToken())).isNotNull();
        verify(userAccounts, times(1)).findById(1L);

        // Even with an access 1s earlier, reaching expiresAt rejects the token without querying DB
        currentTime.set(Instant.parse("2026-11-22T12:00:00Z"));
        assertThat(timedService.resolveToken(login.accessToken())).isNull();
        assertThat(timedService.resolveToken(login.accessToken())).isNull();
        verify(userAccounts, times(1)).findById(1L);
    }

    private static AuthUserAccountPort.AuthUserAccount user(long id, long version) {
        return new AuthUserAccountPort.AuthUserAccount(
                id, "user-" + id, "User " + id, "hash", "SYSTEM_ADMIN", "ACTIVE", version);
    }
}
