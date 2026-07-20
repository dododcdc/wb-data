package com.wbdata.auth.context;

import com.wbdata.auth.service.AuthContextService;
import com.wbdata.auth.service.AuthTokenService;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

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

    private static final class TestableAuthFilter extends AuthFilter {
        private TestableAuthFilter() {
            super(mock(AuthTokenService.class), mock(AuthContextService.class));
        }
    }
}
