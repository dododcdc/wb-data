package com.wbdata.auth.context;

import com.wbdata.auth.service.AuthSession;
import com.wbdata.auth.service.AuthTokenService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.HandlerInterceptor;

@Component
@RequiredArgsConstructor
public class AuthInterceptor implements HandlerInterceptor {

    private final AuthTokenService authTokenService;

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        String header = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (header == null || !header.startsWith("Bearer ")) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "缺少有效的 Authorization 请求头");
        }
        String token = header.substring(7).trim();
        AuthSession session = authTokenService.resolveToken(token);
        if (session == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "登录状态已失效，请重新登录");
        }
        AuthContext.set(session);
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler, Exception ex) {
        AuthContext.clear();
    }
}
