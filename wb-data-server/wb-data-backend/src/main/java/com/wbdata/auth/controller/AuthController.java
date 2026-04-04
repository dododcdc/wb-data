package com.wbdata.auth.controller;

import com.wbdata.auth.dto.AuthContextResponse;
import com.wbdata.auth.dto.CurrentUserResponse;
import com.wbdata.auth.dto.LoginRequest;
import com.wbdata.auth.dto.LoginResponse;
import com.wbdata.auth.service.AuthContextService;
import com.wbdata.auth.service.AuthService;
import com.wbdata.common.Result;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "认证", description = "登录与当前用户信息")
@RestController
@RequestMapping("/api/v1/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;
    private final AuthContextService authContextService;

    @Operation(summary = "登录")
    @PostMapping("/login")
    public Result<LoginResponse> login(@Valid @RequestBody LoginRequest request) {
        return Result.success(authService.login(request));
    }

    @Operation(summary = "获取当前登录用户")
    @GetMapping("/me")
    public Result<CurrentUserResponse> me(@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization) {
        return Result.success(authService.getCurrentUser(authorization));
    }

    @Operation(summary = "获取当前用户项目组上下文")
    @GetMapping("/context")
    public Result<AuthContextResponse> context(@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
                                               @org.springframework.web.bind.annotation.RequestParam(required = false) Long groupId) {
        return Result.success(authContextService.getContext(authorization, groupId));
    }
}
