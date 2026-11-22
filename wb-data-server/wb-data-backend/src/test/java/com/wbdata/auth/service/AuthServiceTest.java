package com.wbdata.auth.service;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.wbdata.auth.dto.LoginRequest;
import com.wbdata.auth.dto.LoginResponse;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AuthServiceTest {
    @Test
    void loginAuditContainsUserIdButNotCredentialsOrResponse() {
        AuthUserAccountPort accounts = mock(AuthUserAccountPort.class);
        PasswordEncoder encoder = mock(PasswordEncoder.class);
        AuthTokenService tokens = new AuthTokenService(accounts);
        AuthService service = new AuthService(accounts, encoder, tokens);
        AuthUserAccountPort.AuthUserAccount user = new AuthUserAccountPort.AuthUserAccount(
                42L, "alice", "Alice", "test-password-hash", "USER", "ACTIVE", 0L);
        when(accounts.findByUsername("alice")).thenReturn(Optional.of(user));
        when(encoder.matches("test-password", "test-password-hash")).thenReturn(true);
        Logger logger = (Logger) LoggerFactory.getLogger(AuthService.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        try {
            LoginResponse response = service.login(new LoginRequest("alice", "test-password"));

            assertThat(appender.list).isNotEmpty();
            assertThat(appender.list).extracting(ILoggingEvent::getFormattedMessage)
                    .anySatisfy(message -> assertThat(message).contains("42", "登录成功"))
                    .allSatisfy(message -> assertThat(message).doesNotContain(
                            response.accessToken(), "test-password", "test-password-hash", "LoginResponse"));
        } finally {
            logger.detachAppender(appender);
            appender.stop();
        }
    }

    @Test
    void loginTrimsWhitespaceInUsername() {
        AuthUserAccountPort accounts = mock(AuthUserAccountPort.class);
        PasswordEncoder encoder = mock(PasswordEncoder.class);
        AuthTokenService tokens = new AuthTokenService(accounts);
        AuthService service = new AuthService(accounts, encoder, tokens);
        AuthUserAccountPort.AuthUserAccount user = new AuthUserAccountPort.AuthUserAccount(
                42L, "alice", "Alice", "test-password-hash", "USER", "ACTIVE", 0L);
        when(accounts.findByUsername("alice")).thenReturn(Optional.of(user));
        when(encoder.matches("test-password", "test-password-hash")).thenReturn(true);

        LoginResponse response = service.login(new LoginRequest("  alice  ", "test-password"));
        assertThat(response).isNotNull();
        assertThat(response.user().username()).isEqualTo("alice");
    }
}
