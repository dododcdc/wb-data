package com.wbdata.workspace.controller;

import com.wbdata.auth.context.AuthContext;
import com.wbdata.auth.context.GroupAccessContext;
import com.wbdata.auth.service.GroupAuthorizationService;
import com.wbdata.common.Result;
import com.wbdata.workspace.dto.WorkspaceSummaryResponse;
import com.wbdata.workspace.service.WorkspaceSummaryService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@Tag(name = "工作区首页", description = "项目组工作区摘要聚合接口")
@RestController
@RequestMapping("/api/v1/groups/{groupId}/workspace")
@RequiredArgsConstructor
public class WorkspaceController {

    private final GroupAuthorizationService groupAuthorizationService;
    private final WorkspaceSummaryService workspaceSummaryService;

    @Operation(summary = "获取项目组工作区摘要")
    @GetMapping("/summary")
    public Result<WorkspaceSummaryResponse> getSummary(@PathVariable Long groupId,
                                                       @RequestParam(required = false) String branch) {
        if (groupId == null || groupId <= 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "groupId 必须是正整数");
        }
        GroupAccessContext access = groupAuthorizationService.requireGroupAccess(AuthContext.require(), groupId);
        return Result.success(workspaceSummaryService.getSummary(access, branch));
    }
}
