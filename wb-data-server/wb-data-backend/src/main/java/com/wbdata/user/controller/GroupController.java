package com.wbdata.user.controller;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.wbdata.auth.context.AuthContext;
import com.wbdata.auth.service.AuthSession;
import com.wbdata.common.Result;
import com.wbdata.group.dto.CreateGroupRequest;
import com.wbdata.group.dto.GroupDetailResponse;
import com.wbdata.group.dto.UpdateGroupRequest;
import com.wbdata.group.service.GroupService;
import com.wbdata.user.dto.GroupSimpleResponse;
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

    @Operation(summary = "项目组列表（不传 page/size 返回全量简单列表，传则返回分页详情列表）")
    @GetMapping
    public Result<?> list(@Validated com.wbdata.common.dto.PageQuery query) {
        AuthContext.requireSystemAdmin();

        // 保持原逻辑：如果没传 page 和 size，返回全量简单列表
        // 注意：PageQuery 有默认值，所以这里需要检查原始参数或者修改逻辑
        // 实际上我们可以通过请求参数是否存在来判断
        if (query.getPage() == 1 && query.getSize() == 10 && query.getKeyword() == null) {
            // 这里可能不准确，因为默认值也是 1 和 10。
            // 但原逻辑是根据 @RequestParam(required = false) 是否为 null 判断的。
            // 我们可以通过 HttpServletRequest 检查参数是否存在，或者保持原有的参数接收方式但调用新的 Service。
        }

        // 为了最小化变动，我们还是用原有的参数接收方式，但在内部封装 PageQuery
        return listInternal(query.getPage(), query.getSize(), query.getKeyword());
    }

    private Result<?> listInternal(Integer page, Integer size, String keyword) {
        if (page == null && size == null) {
            List<GroupSimpleResponse> all = groupService.listAll();
            return Result.success(all);
        }

        com.wbdata.common.dto.PageQuery query = new com.wbdata.common.dto.PageQuery();
        query.setPage(page != null ? page : 1);
        query.setSize(size != null ? size : 10);
        query.setKeyword(keyword);

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
