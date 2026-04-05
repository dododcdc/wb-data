package com.wbdata.auth.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.wbdata.auth.dto.LoginRequest;
import com.wbdata.auth.dto.LoginResponse;
import com.wbdata.user.entity.WbUser;
import com.wbdata.user.mapper.WbUserMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDateTime;

@Service
@RequiredArgsConstructor
public class AuthService {

    private final WbUserMapper wbUserMapper;
    private final PasswordEncoder passwordEncoder;
    private final AuthTokenService authTokenService;

    public LoginResponse login(LoginRequest request) {
        WbUser user = wbUserMapper.selectOne(new LambdaQueryWrapper<WbUser>()
                .eq(WbUser::getUsername, request.username())
                .last("LIMIT 1"));

        if (user == null || !passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "用户名或密码错误");
        }

        if (!"ACTIVE".equalsIgnoreCase(user.getStatus())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "账号已被禁用");
        }

        WbUser update = new WbUser();
        update.setId(user.getId());
        update.setLastLoginAt(LocalDateTime.now());
        wbUserMapper.updateById(update);
        user.setLastLoginAt(update.getLastLoginAt());

        return authTokenService.issueToken(user);
    }
}
