package com.wbdata.group.controller;

import com.wbdata.auth.context.RequireGroupAuth;
import com.wbdata.auth.dto.AuthContextResponse;
import com.wbdata.auth.enums.Permission;
import com.wbdata.common.Result;
import com.wbdata.common.dto.PageQuery;
import com.wbdata.common.dto.PageResult;
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
    public Result<PageResult<MemberResponse>> listMembers(
            @RequireGroupAuth(Permission.MEMBER_READ) AuthContextResponse context,
            @Validated PageQuery query) {
        return Result.success(groupSettingsService.listMembers(
                context.currentGroup().id(), query));
    }

    @Operation(summary = "可添加用户列表")
    @GetMapping("/available-users")
    public Result<PageResult<AvailableUserResponse>> listAvailableUsers(
            @RequireGroupAuth(Permission.MEMBER_MANAGE) AuthContextResponse context,
            @Validated PageQuery query) {
        // 由于前端可能需要更大的分页大小，我们可以在此设置默认值或让前端传
        return Result.success(groupSettingsService.listAvailableUsers(
                context.currentGroup().id(), query));
    }

    @Operation(summary = "添加成员")
    @PostMapping("/members")
    public Result<MemberResponse> addMember(
            @RequireGroupAuth(Permission.MEMBER_MANAGE) AuthContextResponse context,
            @Validated @RequestBody AddMemberRequest req) {
        return Result.success(groupSettingsService.addMember(
                context.currentGroup().id(), req, context.user().id()));
    }

    @Operation(summary = "批量添加成员")
    @PostMapping("/members/batch")
    public Result<Void> addMembers(
            @RequireGroupAuth(Permission.MEMBER_MANAGE) AuthContextResponse context,
            @Validated @RequestBody AddMembersRequest req) {
        groupSettingsService.addMembers(context.currentGroup().id(), req, context.user().id());
        return Result.success(null);
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
