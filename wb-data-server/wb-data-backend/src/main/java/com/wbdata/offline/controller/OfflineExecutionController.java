package com.wbdata.offline.controller;

import com.wbdata.auth.context.AuthContext;
import com.wbdata.auth.dto.AuthContextResponse;
import com.wbdata.auth.enums.Permission;
import com.wbdata.auth.service.AuthContextService;
import com.wbdata.auth.service.AuthSession;
import com.wbdata.common.Result;
import com.wbdata.offline.dto.DebugExecutionRequest;
import com.wbdata.offline.dto.OfflineExecutionDetailResponse;
import com.wbdata.offline.dto.OfflineExecutionListItem;
import com.wbdata.offline.dto.OfflineExecutionLogEntry;
import com.wbdata.offline.dto.OfflineExecutionResponse;
import com.wbdata.offline.dto.SavedDebugExecutionRequest;
import com.wbdata.offline.service.OfflineExecutionService;
import com.wbdata.offline.service.OfflineFlowContentService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

@Tag(name = "离线开发", description = "Flow 调试执行与执行结果")
@RestController
@RequestMapping("/api/v1/offline/executions")
@RequiredArgsConstructor
public class OfflineExecutionController {

    private final AuthContextService authContextService;
    private final OfflineExecutionService offlineExecutionService;
    private final OfflineFlowContentService offlineFlowContentService;

    @Operation(summary = "基于当前草稿触发调试执行")
    @PostMapping("/debug")
    public Result<OfflineExecutionResponse> createDebugExecution(@Valid @RequestBody DebugExecutionRequest request) {
        AuthSession session = AuthContext.require();
        requireGroupContext(session, request.groupId(), Permission.OFFLINE_WRITE.code());
        return Result.success(offlineExecutionService.createDebugExecution(request, session.id()));
    }

    @Operation(summary = "基于当前已保存文件触发调试执行")
    @PostMapping("/debug/current")
    public Result<OfflineExecutionResponse> createDebugExecutionFromSaved(@Valid @RequestBody SavedDebugExecutionRequest request) {
        AuthSession session = AuthContext.require();
        AuthContextResponse context = requireGroupContext(session, request.groupId(), Permission.OFFLINE_WRITE.code());
        var flow = offlineFlowContentService.getFlowContent(context.currentGroup().id(), request.flowPath());
        DebugExecutionRequest resolvedRequest = new DebugExecutionRequest(
                context.currentGroup().id(),
                request.flowPath(),
                flow.content(),
                request.selectedTaskIds(),
                request.mode()
        );
        return Result.success(offlineExecutionService.createDebugExecution(resolvedRequest, session.id()));
    }

    @Operation(summary = "查询当前 Flow 的执行记录")
    @GetMapping
    public Result<List<OfflineExecutionListItem>> listExecutions(@RequestParam Long groupId,
                                                                 @RequestParam String flowPath) {
        AuthSession session = AuthContext.require();
        requireGroupContext(session, groupId, Permission.OFFLINE_READ.code());
        return Result.success(offlineExecutionService.listExecutions(groupId, flowPath));
    }

    @Operation(summary = "查询执行详情")
    @GetMapping("/{executionId}")
    public Result<OfflineExecutionDetailResponse> getExecution(@RequestParam Long groupId,
                                                               @PathVariable String executionId) {
        AuthSession session = AuthContext.require();
        requireGroupContext(session, groupId, Permission.OFFLINE_READ.code());
        return Result.success(offlineExecutionService.getExecution(groupId, executionId));
    }

    @Operation(summary = "查询执行日志")
    @GetMapping("/{executionId}/logs")
    public Result<List<OfflineExecutionLogEntry>> getExecutionLogs(@RequestParam Long groupId,
                                                                   @PathVariable String executionId,
                                                                   @RequestParam(required = false) String taskId) {
        AuthSession session = AuthContext.require();
        requireGroupContext(session, groupId, Permission.OFFLINE_READ.code());
        return Result.success(offlineExecutionService.getExecutionLogs(groupId, executionId, taskId));
    }

    @Operation(summary = "停止单个执行")
    @PostMapping("/{executionId}/stop")
    public Result<Void> stopExecution(@RequestParam Long groupId,
                                      @PathVariable String executionId) {
        AuthSession session = AuthContext.require();
        requireGroupContext(session, groupId, Permission.OFFLINE_WRITE.code());
        offlineExecutionService.stopExecution(groupId, executionId);
        return Result.success(null);
    }

    @Operation(summary = "停止当前 Flow 所有运行中的执行")
    @PostMapping("/stop-all")
    public Result<Integer> stopAllExecutions(@RequestParam Long groupId,
                                             @RequestParam String flowPath) {
        AuthSession session = AuthContext.require();
        requireGroupContext(session, groupId, Permission.OFFLINE_WRITE.code());
        return Result.success(offlineExecutionService.stopAllExecutions(groupId, flowPath));
    }

    private AuthContextResponse requireGroupContext(AuthSession session, Long groupId, String permission) {
        AuthContextResponse context = authContextService.getContext(session, groupId);
        if (context.currentGroup() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "当前未选中项目组");
        }
        if (!context.permissions().contains(permission)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "当前项目组下无此操作权限: " + permission);
        }
        return context;
    }
}
