package com.wbdata.user.controller;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.wbdata.auth.context.AuthContext;
import com.wbdata.auth.service.AuthSession;
import com.wbdata.common.Result;
import com.wbdata.user.dto.CreateUserRequest;
import com.wbdata.user.dto.ResetPasswordRequest;
import com.wbdata.user.dto.UpdateUserRequest;
import com.wbdata.user.dto.UpdateUserStatusRequest;
import com.wbdata.user.dto.UserGroupResponse;
import com.wbdata.user.dto.UserResponse;
import com.wbdata.user.service.UserService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@Tag(name = "用户管理", description = "用户的增删改查（SYSTEM_ADMIN 专属）")
@RestController
@RequestMapping("/api/v1/users")
@RequiredArgsConstructor
public class UserController {

    private final UserService userService;

    @Operation(summary = "用户分页列表")
    @GetMapping
    public Result<IPage<UserResponse>> list(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "10") int size,
            @RequestParam(required = false) String keyword) {
        AuthContext.requireSystemAdmin();
        return Result.success(userService.listUsers(page, size, keyword));
    }

    @Operation(summary = "创建用户")
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Result<UserResponse> create(
            @Validated @RequestBody CreateUserRequest request) {
        AuthSession operator = AuthContext.requireSystemAdmin();
        return Result.success(userService.createUser(request, operator.id()));
    }

    @Operation(summary = "编辑用户")
    @PutMapping("/{id}")
    public Result<UserResponse> update(
            @PathVariable Long id,
            @Validated @RequestBody UpdateUserRequest request) {
        AuthSession operator = AuthContext.requireSystemAdmin();
        return Result.success(userService.updateUser(id, request, operator.id()));
    }

    @Operation(summary = "修改用户状态")
    @PatchMapping("/{id}/status")
    public Result<Void> changeStatus(
            @PathVariable Long id,
            @Validated @RequestBody UpdateUserStatusRequest request) {
        AuthSession operator = AuthContext.requireSystemAdmin();
        userService.changeStatus(id, request, operator.id());
        return Result.success(null);
    }

    @Operation(summary = "重置密码")
    @PostMapping("/{id}/reset-password")
    public Result<Void> resetPassword(
            @PathVariable Long id,
            @Validated @RequestBody ResetPasswordRequest request) {
        AuthSession operator = AuthContext.requireSystemAdmin();
        userService.resetPassword(id, request, operator.id());
        return Result.success(null);
    }

    @Operation(summary = "获取用户项目组列表")
    @GetMapping("/{id}/groups")
    public Result<List<UserGroupResponse>> getUserGroups(@PathVariable Long id) {
        AuthContext.requireSystemAdmin();
        return Result.success(userService.getUserGroups(id));
    }
}
