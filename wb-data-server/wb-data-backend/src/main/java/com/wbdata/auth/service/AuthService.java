package com.wbdata.auth.service;

import com.wbdata.auth.dto.LoginRequest;
import com.wbdata.auth.dto.LoginResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDateTime;

@Slf4j
@Service
@RequiredArgsConstructor
public class AuthService {

    private final AuthUserAccountPort userAccountPort;
    private final PasswordEncoder passwordEncoder;
    private final AuthTokenService authTokenService;

    public LoginResponse login(LoginRequest request) {
        String username = request.username() == null ? "" : request.username().trim();
        AuthUserAccountPort.AuthUserAccount user = userAccountPort.findByUsername(username).orElse(null);

        if (user == null || !passwordEncoder.matches(request.password(), user.passwordHash())) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "用户名或密码错误");
        }

        if (!"ACTIVE".equalsIgnoreCase(user.status())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "账号已被禁用");
        }

        userAccountPort.updateLastLoginAt(user.id(), LocalDateTime.now());
        LoginResponse loginResponse = authTokenService.issueToken(user);
        log.info("用户 {} 登录成功", user.id());
        return loginResponse;
    }
}
