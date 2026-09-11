package com.wbdata.parameter.controller;

import com.wbdata.auth.context.RequireGroupAuth;
import com.wbdata.auth.dto.AuthContextResponse;
import com.wbdata.auth.enums.Permission;
import com.wbdata.common.Result;
import com.wbdata.common.dto.PageQuery;
import com.wbdata.common.dto.PageResult;
import com.wbdata.parameter.dto.CreateParameterGroupRequest;
import com.wbdata.parameter.dto.ParameterGroupResponse;
import com.wbdata.parameter.dto.ParameterGroupSummaryResponse;
import com.wbdata.parameter.dto.ParameterPreviewRequest;
import com.wbdata.parameter.dto.ParameterPreviewResponse;
import com.wbdata.parameter.dto.UpdateParameterGroupRequest;
import com.wbdata.parameter.service.ParameterGroupService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "参数组", description = "项目组参数的管理、版本控制和预览")
@RestController
@RequestMapping({"/api/v1/parameter-groups", "/api/v1/groups/{groupId}/parameter-groups"})
@RequiredArgsConstructor
public class ParameterGroupController {
    private final ParameterGroupService parameterGroupService;

    @Operation(summary = "参数组列表")
    @GetMapping
    public Result<PageResult<ParameterGroupSummaryResponse>> list(
            @RequireGroupAuth(Permission.PARAMETER_READ) AuthContextResponse context,
            @Validated PageQuery query,
            @RequestParam(required = false) String status) {
        return Result.success(parameterGroupService.list(context.currentGroup().id(), query, status));
    }

    @Operation(summary = "创建参数组")
    @PostMapping
    public Result<ParameterGroupResponse> create(
            @RequireGroupAuth(Permission.PARAMETER_WRITE) AuthContextResponse context,
            @Valid @RequestBody CreateParameterGroupRequest request) {
        return Result.success(parameterGroupService.create(
                context.currentGroup().id(), context.user().id(), request));
    }

    @Operation(summary = "获取参数组详情")
    @GetMapping("/{id}")
    public Result<ParameterGroupResponse> get(
            @RequireGroupAuth(Permission.PARAMETER_READ) AuthContextResponse context,
            @PathVariable Long id) {
        return Result.success(parameterGroupService.get(context.currentGroup().id(), id));
    }

    @Operation(summary = "更新参数组")
    @PutMapping("/{id}")
    public Result<ParameterGroupResponse> update(
            @RequireGroupAuth(Permission.PARAMETER_WRITE) AuthContextResponse context,
            @PathVariable Long id,
            @Valid @RequestBody UpdateParameterGroupRequest request) {
        return Result.success(parameterGroupService.update(
                context.currentGroup().id(), id, context.user().id(), request));
    }

    @Operation(summary = "归档参数组")
    @PostMapping("/{id}/archive")
    public Result<ParameterGroupResponse> archive(
            @RequireGroupAuth(Permission.PARAMETER_WRITE) AuthContextResponse context,
            @PathVariable Long id) {
        return Result.success(parameterGroupService.archive(
                context.currentGroup().id(), id, context.user().id()));
    }

    @Operation(summary = "恢复参数组")
    @PostMapping("/{id}/restore")
    public Result<ParameterGroupResponse> restore(
            @RequireGroupAuth(Permission.PARAMETER_WRITE) AuthContextResponse context,
            @PathVariable Long id) {
        return Result.success(parameterGroupService.restore(
                context.currentGroup().id(), id, context.user().id()));
    }

    @Operation(summary = "预览参数解析结果")
    @PostMapping("/{id}/preview")
    public Result<ParameterPreviewResponse> preview(
            @RequireGroupAuth(Permission.PARAMETER_READ) AuthContextResponse context,
            @PathVariable Long id,
            @Valid @RequestBody ParameterPreviewRequest request) {
        return Result.success(parameterGroupService.preview(context.currentGroup().id(), id, request));
    }
}
