package com.wbdata.auth.context;

import com.wbdata.auth.dto.AuthContextResponse;
import com.wbdata.auth.service.AuthContextService;
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

/**
 * Enhanced Auth Filter for early resolution of authentication and group context.
 * Stores result in request attribute to avoid Spring MVC binding interference.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AuthFilter extends OncePerRequestFilter {

    public static final String AUTH_CONTEXT_ATTRIBUTE = "RESOLVED_AUTH_CONTEXT";

    private final AuthTokenService authTokenService;
    private final AuthContextService authContextService;
    private final AntPathMatcher pathMatcher = new AntPathMatcher();

    // Paths to exclude from authentication
    private final List<String> excludedPaths = Arrays.asList(
            "/api/v1/auth/login",
            "/api/v1/datasources/plugins",
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

        // Only filter API requests
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
        log.info("AuthFilter processing request: {} {}", request.getMethod(), path);

        // Skip OPTIONS requests as they are handled by CorsFilter
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            log.debug("AuthFilter skipping OPTIONS request");
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
            log.warn("AuthFilter: Token invalid or expired: {}", token);
            sendError(response, HttpStatus.UNAUTHORIZED, "登录状态已失效，请重新登录");
            return;
        }

        log.debug("AuthFilter: Session found for user: {}", session.username());

        try {
            AuthContext.set(session);
            
            // Resolve Group Context early if possible
            Long groupId = resolveGroupId(request);
            if (groupId != null) {
                try {
                    AuthContextResponse context = authContextService.getContext(session, groupId);
                    request.setAttribute(AUTH_CONTEXT_ATTRIBUTE, context);
                    log.debug("AuthFilter: Resolved AuthContext for group: {}", groupId);
                } catch (Exception e) {
                    log.error("AuthFilter: Failed to resolve auth context for group {}: {}", groupId, e.getMessage());
                    // We don't block here, let the resolver handle the error if it's missing
                }
            }

            filterChain.doFilter(request, response);
        } finally {
            log.debug("AuthFilter: Clearing AuthContext for path: {}", path);
            AuthContext.clear();
        }
    }

    private Long resolveGroupId(HttpServletRequest request) {
        String groupIdStr = request.getParameter("groupId");
        if (StringUtils.hasText(groupIdStr)) {
            try {
                return Long.parseLong(groupIdStr);
            } catch (NumberFormatException e) {
                return null;
            }
        }
        return null;
    }

    private void sendError(HttpServletResponse response, HttpStatus status, String message) throws IOException {
        response.setStatus(status.value());
        response.setContentType("application/json;charset=UTF-8");
        // Simple JSON response format consistent with Result class
        String json = String.format("{\"code\":%d,\"message\":\"%s\",\"data\":null}", status.value(), message);
        response.getWriter().write(json);
    }
}
