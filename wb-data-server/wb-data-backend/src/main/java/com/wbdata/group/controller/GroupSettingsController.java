package com.wbdata.group.controller;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.wbdata.auth.dto.AuthContextResponse;
import com.wbdata.auth.service.AuthContextService;
import com.wbdata.common.Result;
import com.wbdata.group.dto.*;
import com.wbdata.group.service.GroupSettingsService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

@Tag(name = "成员与设置", description = "项目组信息、成员管理")
@RestController
@RequestMapping("/api/v1/group-settings")
@RequiredArgsConstructor
public class GroupSettingsController {

    private final AuthContextService authContextService;
    private final GroupSettingsService groupSettingsService;

    @Operation(summary = "获取项目组信息")
    @GetMapping
    public Result<GroupSettingsResponse> getGroupInfo(
            @RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
            @RequestParam Long groupId) {
        AuthContextResponse context = requireContext(authorization, groupId, "member.read");
        return Result.success(groupSettingsService.getGroupInfo(context.currentGroup().id()));
    }

    @Operation(summary = "更新项目组信息")
    @PutMapping
    public Result<GroupSettingsResponse> updateGroupInfo(
            @RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
            @RequestParam Long groupId,
            @Validated @RequestBody UpdateGroupSettingsRequest req) {
        AuthContextResponse context = requireContext(authorization, groupId, "group.settings");
        return Result.success(groupSettingsService.updateGroupInfo(
                context.currentGroup().id(), req, context.user().id()));
    }

    @Operation(summary = "成员列表")
    @GetMapping("/members")
    public Result<IPage<MemberResponse>> listMembers(
            @RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
            @RequestParam Long groupId,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String keyword) {
        AuthContextResponse context = requireContext(authorization, groupId, "member.read");
        return Result.success(groupSettingsService.listMembers(
                context.currentGroup().id(), page, size, keyword));
    }

    @Operation(summary = "可添加用户列表")
    @GetMapping("/available-users")
    public Result<List<AvailableUserResponse>> listAvailableUsers(
            @RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
            @RequestParam Long groupId,
            @RequestParam(required = false) String keyword) {
        AuthContextResponse context = requireContext(authorization, groupId, "member.manage");
        return Result.success(groupSettingsService.listAvailableUsers(
                context.currentGroup().id(), keyword));
    }

    @Operation(summary = "添加成员")
    @PostMapping("/members")
    public Result<MemberResponse> addMember(
            @RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
            @RequestParam Long groupId,
            @Validated @RequestBody AddMemberRequest req) {
        AuthContextResponse context = requireContext(authorization, groupId, "member.manage");
        return Result.success(groupSettingsService.addMember(
                context.currentGroup().id(), req, context.user().id()));
    }

    @Operation(summary = "修改成员角色")
    @PutMapping("/members/{id}/role")
    public Result<Void> updateMemberRole(
            @RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
            @RequestParam Long groupId,
            @PathVariable Long id,
            @Validated @RequestBody UpdateMemberRoleRequest req) {
        AuthContextResponse context = requireContext(authorization, groupId, "member.manage");
        groupSettingsService.updateMemberRole(id, req, context.user().id());
        return Result.success(null);
    }

    @Operation(summary = "移除成员")
    @DeleteMapping("/members/{id}")
    public Result<Void> removeMember(
            @RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
            @RequestParam Long groupId,
            @PathVariable Long id) {
        AuthContextResponse context = requireContext(authorization, groupId, "member.manage");
        groupSettingsService.removeMember(id, context.user().id());
        return Result.success(null);
    }

    private AuthContextResponse requireContext(String authorization, Long groupId, String permission) {
        AuthContextResponse context = authContextService.getContext(authorization, groupId);
        if (context.currentGroup() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "当前未选中项目组");
        }
        if (!context.permissions().contains(permission)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "当前项目组下无此操作权限: " + permission);
        }
        return context;
    }
}
