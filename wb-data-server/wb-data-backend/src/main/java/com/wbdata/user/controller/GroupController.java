package com.wbdata.user.controller;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.wbdata.auth.context.AuthContext;
import com.wbdata.auth.service.AuthSession;
import com.wbdata.common.Result;
import com.wbdata.common.dto.PageQuery;
import com.wbdata.common.dto.PageResult;
import com.wbdata.group.dto.CreateGroupRequest;
import com.wbdata.group.dto.GroupDetailResponse;
import com.wbdata.group.dto.UpdateGroupRequest;
import com.wbdata.group.service.GroupService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
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

@Tag(name = "项目组", description = "项目组管理（SYSTEM_ADMIN 专属）")
@RestController
@RequestMapping("/api/v1/groups")
@RequiredArgsConstructor
public class GroupController {

    private final GroupService groupService;

    @Operation(summary = "项目组分页列表")
    @GetMapping
    public Result<PageResult<GroupDetailResponse>> list(@Validated PageQuery query) {
        AuthContext.requireSystemAdmin();
        return Result.success(groupService.listGroups(query));
    }

    @Operation(summary = "创建项目组")
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Result<GroupDetailResponse> create(
            @Validated @RequestBody CreateGroupRequest request) {
        AuthSession operator = AuthContext.requireSystemAdmin();
        return Result.success(groupService.createGroup(request, operator.id()));
    }

    @Operation(summary = "删除项目组")
    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable Long id) {
        AuthContext.requireSystemAdmin();
        groupService.deleteGroup(id);
        return Result.success(null);
    }

    @Operation(summary = "更新项目组")
    @PutMapping("/{id}")
    public Result<GroupDetailResponse> update(
            @PathVariable Long id,
            @Validated @RequestBody UpdateGroupRequest request) {
        AuthSession operator = AuthContext.requireSystemAdmin();
        return Result.success(groupService.updateGroup(id, request, operator.id()));
    }

    @Operation(summary = "禁用项目组")
    @PatchMapping("/{id}/disable")
    public Result<GroupDetailResponse> disable(@PathVariable Long id) {
        AuthContext.requireSystemAdmin();
        return Result.success(groupService.disableGroup(id));
    }

    @Operation(summary = "启用项目组")
    @PatchMapping("/{id}/enable")
    public Result<GroupDetailResponse> enable(@PathVariable Long id) {
        AuthContext.requireSystemAdmin();
        return Result.success(groupService.enableGroup(id));
    }
}
