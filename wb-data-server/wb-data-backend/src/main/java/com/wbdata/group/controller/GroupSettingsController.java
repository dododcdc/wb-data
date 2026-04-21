package com.wbdata.group.controller;

import com.wbdata.auth.context.RequireGroupAuth;
import com.wbdata.auth.dto.AuthContextResponse;
import com.wbdata.auth.enums.Permission;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.wbdata.common.Result;
import com.wbdata.group.dto.*;
import com.wbdata.group.service.GroupSettingsService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
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

    private final GroupSettingsService groupSettingsService;

    @Operation(summary = "获取项目组信息")
    @GetMapping
    public Result<GroupSettingsResponse> getGroupInfo(
            @RequireGroupAuth(Permission.MEMBER_READ) AuthContextResponse context) {
        return Result.success(groupSettingsService.getGroupInfo(context.currentGroup().id()));
    }

    @Operation(summary = "更新项目组信息")
    @PutMapping
    public Result<GroupSettingsResponse> updateGroupInfo(
            @RequireGroupAuth(Permission.GROUP_SETTINGS) AuthContextResponse context,
            @Validated @RequestBody UpdateGroupSettingsRequest req) {
        return Result.success(groupSettingsService.updateGroupInfo(
                context.currentGroup().id(), req, context.user().id()));
    }

    @Operation(summary = "成员列表")
    @GetMapping("/members")
    public Result<IPage<MemberResponse>> listMembers(
            @RequireGroupAuth(Permission.MEMBER_READ) AuthContextResponse context,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String keyword) {
        return Result.success(groupSettingsService.listMembers(
                context.currentGroup().id(), page, size, keyword));
    }

    @Operation(summary = "可添加用户列表")
    @GetMapping("/available-users")
    public Result<List<AvailableUserResponse>> listAvailableUsers(
            @RequireGroupAuth(Permission.MEMBER_MANAGE) AuthContextResponse context,
            @RequestParam(required = false) String keyword) {
        return Result.success(groupSettingsService.listAvailableUsers(
                context.currentGroup().id(), keyword));
    }

    @Operation(summary = "添加成员")
    @PostMapping("/members")
    public Result<MemberResponse> addMember(
            @RequireGroupAuth(Permission.MEMBER_MANAGE) AuthContextResponse context,
            @Validated @RequestBody AddMemberRequest req) {
        return Result.success(groupSettingsService.addMember(
                context.currentGroup().id(), req, context.user().id()));
    }

    @Operation(summary = "修改成员角色")
    @PutMapping("/members/{id}/role")
    public Result<Void> updateMemberRole(
            @RequireGroupAuth(Permission.MEMBER_MANAGE) AuthContextResponse context,
            @PathVariable Long id,
            @Validated @RequestBody UpdateMemberRoleRequest req) {
        groupSettingsService.updateMemberRole(id, req, context.user().id());
        return Result.success(null);
    }

    @Operation(summary = "移除成员")
    @DeleteMapping("/members/{id}")
    public Result<Void> removeMember(
            @RequireGroupAuth(Permission.MEMBER_MANAGE) AuthContextResponse context,
            @PathVariable Long id) {
        groupSettingsService.removeMember(id, context.user().id());
        return Result.success(null);
    }

}
