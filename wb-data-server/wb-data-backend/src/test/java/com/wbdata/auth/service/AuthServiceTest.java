package com.wbdata.auth.service;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.wbdata.auth.dto.LoginRequest;
import com.wbdata.auth.dto.LoginResponse;
import com.wbdata.user.entity.WbUser;
import com.wbdata.user.mapper.WbUserMapper;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.security.crypto.password.PasswordEncoder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AuthServiceTest {
    @Test
    void loginAuditContainsUserIdButNotCredentialsOrResponse() {
        WbUserMapper mapper = mock(WbUserMapper.class);
        PasswordEncoder encoder = mock(PasswordEncoder.class);
        AuthTokenService tokens = new AuthTokenService(mapper);
        AuthService service = new AuthService(mapper, encoder, tokens);
        WbUser user = new WbUser();
        user.setId(42L);
        user.setUsername("alice");
        user.setPasswordHash("test-password-hash");
        user.setSystemRole("USER");
        user.setStatus("ACTIVE");
        user.setAuthVersion(0L);
        when(mapper.selectOne(any())).thenReturn(user);
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
}
