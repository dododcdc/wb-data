package com.wbdata.auth.context;

import com.wbdata.auth.service.AuthSession;
import com.wbdata.auth.service.AuthTokenService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.util.AntPathMatcher;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Arrays;
import java.util.List;

@Slf4j
@Component
@RequiredArgsConstructor
public class AuthFilter extends OncePerRequestFilter {
    private final AuthTokenService authTokenService;
    private final AntPathMatcher pathMatcher = new AntPathMatcher();

    private final List<String> excludedPaths = Arrays.asList(
            "/api/v1/auth/login",
            "/api/v1/datasources/plugins",
            "/api/v1/internal/offline/transfer/**",
            "/api/v1/internal/offline/script/**",
            "/v3/api-docs/**",
            "/swagger-ui/**",
            "/swagger-ui.html"
    );

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        String contextPath = request.getContextPath();
        if (StringUtils.hasText(contextPath) && path.startsWith(contextPath)) {
            path = path.substring(contextPath.length());
        }
        log.debug("AuthFilter checking path: {}", path);
        if (!path.startsWith("/api/")) {
            return true;
        }
        final String finalPath = path;
        boolean excluded = excludedPaths.stream().anyMatch(p -> pathMatcher.match(p, finalPath));
        if (excluded) {
            log.debug("AuthFilter excluding path: {}", path);
        }
        return excluded;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        String path = request.getRequestURI();
        log.debug("AuthFilter processing request: {} {}", request.getMethod(), path);
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            filterChain.doFilter(request, response);
            return;
        }

        String header = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (header == null || !header.startsWith("Bearer ")) {
            log.warn("AuthFilter: Missing or invalid Authorization header for path: {}", path);
            sendError(response, HttpStatus.UNAUTHORIZED, "缺少有效的 Authorization 请求头");
            return;
        }
        String token = header.substring(7).trim();
        AuthSession session = authTokenService.resolveToken(token);
        if (session == null) {
            log.warn("AuthFilter: Token invalid or expired");
            sendError(response, HttpStatus.UNAUTHORIZED, "登录状态已失效，请重新登录");
            return;
        }
        try {
            AuthContext.set(session);
            filterChain.doFilter(request, response);
        } finally {
            AuthContext.clear();
        }
    }

    private void sendError(HttpServletResponse response, HttpStatus status, String message) throws IOException {
        response.setStatus(status.value());
        response.setContentType("application/json;charset=UTF-8");
        String json = String.format("{\"code\":%d,\"message\":\"%s\",\"data\":null}", status.value(), message);
        response.getWriter().write(json);
    }
}
