package com.wbdata.auth.context;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.wbdata.auth.controller.AuthController;
import com.wbdata.auth.service.AuthContextService;
import com.wbdata.auth.service.AuthService;
import com.wbdata.auth.service.AuthTokenService;
import com.wbdata.user.entity.WbUser;
import com.wbdata.user.mapper.WbUserMapper;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class AuthFilterTest {

    @Test
    void internalTransferRenderSkipsBearerAuthentication() {
        TestableAuthFilter filter = new TestableAuthFilter();
        MockHttpServletRequest request = new MockHttpServletRequest(
                "POST",
                "/api/v1/internal/offline/transfer/render"
        );

        assertThat(filter.shouldNotFilter(request)).isTrue();
    }

    @Test
    void ordinaryApiRequestsStillRequireBearerAuthentication() {
        TestableAuthFilter filter = new TestableAuthFilter();
        MockHttpServletRequest request = new MockHttpServletRequest(
                "GET",
                "/api/v1/groups/4/offline/flows"
        );

        assertThat(filter.shouldNotFilter(request)).isFalse();
    }

    @Test
    void rejectedTokenIsNotWrittenToLogsOrResponse() throws Exception {
        TestableAuthFilter filter = new TestableAuthFilter();
        String token = "rejected-sensitive-token";
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/auth/me");
        request.addHeader("Authorization", "Bearer " + token);
        MockHttpServletResponse response = new MockHttpServletResponse();
        Logger logger = (Logger) LoggerFactory.getLogger(AuthFilter.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        try {
            filter.doFilter(request, response, (req, res) -> {
                throw new AssertionError("Invalid token reached controller");
            });

            assertThat(response.getStatus()).isEqualTo(401);
            assertThat(response.getContentAsString()).doesNotContain(token);
            assertThat(appender.list).isNotEmpty();
            assertThat(appender.list).extracting(ILoggingEvent::getFormattedMessage)
                    .allSatisfy(message -> assertThat(message).doesNotContain(token));
        } finally {
            logger.detachAppender(appender);
            appender.stop();
        }
    }

    @Test
    void logoutMakesSubsequentAuthenticatedRequestUnauthorized() throws Exception {
        WbUserMapper mapper = mock(WbUserMapper.class);
        WbUser user = new WbUser();
        user.setId(1L);
        user.setStatus("ACTIVE");
        user.setSystemRole("USER");
        user.setAuthVersion(0L);
        org.mockito.Mockito.when(mapper.selectById(1L)).thenReturn(user);
        AuthTokenService tokens = new AuthTokenService(mapper);
        AuthContextService contexts = mock(AuthContextService.class);
        AuthFilter filter = new AuthFilter(tokens, contexts);
        AuthController controller = new AuthController(mock(AuthService.class), contexts, tokens);
        String token = tokens.issueToken(user).accessToken();
        MockHttpServletRequest logout = new MockHttpServletRequest("POST", "/api/v1/auth/logout");
        logout.addHeader("Authorization", "Bearer " + token);
        MockHttpServletResponse logoutResponse = new MockHttpServletResponse();

        filter.doFilter(logout, logoutResponse, (req, res) -> {
            assertThat(AuthContext.require().id()).isEqualTo(1L);
            controller.logout(logout);
        });
        assertThat(logoutResponse.getStatus()).isEqualTo(200);
        assertThat(AuthContext.current()).isNull();

        MockHttpServletRequest me = new MockHttpServletRequest("GET", "/api/v1/auth/me");
        me.addHeader("Authorization", "Bearer " + token);
        MockHttpServletResponse meResponse = new MockHttpServletResponse();
        filter.doFilter(me, meResponse, (req, res) -> {
            throw new AssertionError("Revoked token reached controller");
        });
        assertThat(meResponse.getStatus()).isEqualTo(401);
    }

    private static final class TestableAuthFilter extends AuthFilter {
        private TestableAuthFilter() {
            super(mock(AuthTokenService.class), mock(AuthContextService.class));
        }
    }
}
