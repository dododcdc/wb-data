package com.wbdata.offline.controller;

import com.wbdata.auth.context.AuthContext;
import com.wbdata.auth.context.RequireGroupAuth;
import com.wbdata.auth.dto.AuthContextResponse;
import com.wbdata.auth.enums.Permission;
import com.wbdata.common.Result;
import com.wbdata.offline.dto.DebugDocumentExecutionRequest;
import com.wbdata.offline.dto.DebugExecutionRequest;
import com.wbdata.offline.dto.OfflineExecutionDetailResponse;
import com.wbdata.offline.dto.OfflineExecutionListItem;
import com.wbdata.offline.dto.OfflineExecutionLogEntry;
import com.wbdata.offline.dto.OfflineExecutionResponse;
import com.wbdata.offline.dto.OfflineExecutionScriptResponse;
import com.wbdata.offline.dto.SavedDebugExecutionRequest;
import com.wbdata.offline.service.OfflineExecutionService;
import com.wbdata.offline.service.OfflineFlowContentService;
import com.wbdata.offline.service.OfflineFlowDocumentService;
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

    private final OfflineExecutionService offlineExecutionService;
    private final OfflineFlowContentService offlineFlowContentService;
    private final OfflineFlowDocumentService offlineFlowDocumentService;

    @Operation(summary = "基于当前草稿触发调试执行")
    @PostMapping("/debug")
    public Result<OfflineExecutionResponse> createDebugExecution(@RequireGroupAuth(Permission.OFFLINE_WRITE) AuthContextResponse context,
                                                                 @Valid @RequestBody DebugExecutionRequest request) {
        return Result.success(offlineExecutionService.createDebugExecution(request, context.user().id()));
    }

    @Operation(summary = "基于当前已保存文件触发调试执行")
    @PostMapping("/debug/current")
    public Result<OfflineExecutionResponse> createDebugExecutionFromSaved(@RequireGroupAuth(Permission.OFFLINE_WRITE) AuthContextResponse context,
                                                                          @Valid @RequestBody SavedDebugExecutionRequest request) {
        var flow = offlineFlowContentService.getFlowContent(context.currentGroup().id(), request.flowPath());
        DebugExecutionRequest resolvedRequest = new DebugExecutionRequest(
                context.currentGroup().id(),
                request.flowPath(),
                flow.content(),
                request.selectedTaskIds(),
                request.mode()
        );
        return Result.success(offlineExecutionService.createDebugExecution(resolvedRequest, context.user().id()));
    }

    @Operation(summary = "基于当前草稿文档触发调试执行")
    @PostMapping("/debug/document")
    public Result<OfflineExecutionResponse> createDebugExecutionFromDocument(@RequireGroupAuth(Permission.OFFLINE_WRITE) AuthContextResponse context,
                                                                             @Valid @RequestBody DebugDocumentExecutionRequest request) {
        var compiledDraft = offlineFlowDocumentService.compileFlowDraft(request);
        DebugExecutionRequest resolvedRequest = new DebugExecutionRequest(
                context.currentGroup().id(),
                request.flowPath(),
                compiledDraft.content(),
                request.selectedTaskIds(),
                request.mode()
        );
        return Result.success(offlineExecutionService.createDebugExecution(
                resolvedRequest,
                compiledDraft.namespaceFileContents(),
                context.user().id()
        ));
    }

    @Operation(summary = "查询当前 Flow 的执行记录")
    @GetMapping
    public Result<List<OfflineExecutionListItem>> listExecutions(@RequireGroupAuth(Permission.OFFLINE_READ) AuthContextResponse context,
                                                                 @RequestParam String flowPath,
                                                                 @RequestParam(required = false) Long requestedBy) {
        return Result.success(offlineExecutionService.listExecutions(context.currentGroup().id(), flowPath, requestedBy));
    }

    @Operation(summary = "查询执行详情")
    @GetMapping("/{executionId}")
    public Result<OfflineExecutionDetailResponse> getExecution(@RequireGroupAuth(Permission.OFFLINE_READ) AuthContextResponse context,
                                                               @PathVariable String executionId) {
        return Result.success(offlineExecutionService.getExecution(context.currentGroup().id(), executionId));
    }

    @Operation(summary = "查询执行脚本")
    @GetMapping("/{executionId}/script")
    public Result<OfflineExecutionScriptResponse> getExecutionScript(@RequireGroupAuth(Permission.OFFLINE_READ) AuthContextResponse context,
                                                                     @PathVariable String executionId) {
        return Result.success(offlineExecutionService.getExecutionScript(context.currentGroup().id(), executionId));
    }

    @Operation(summary = "查询执行日志")
    @GetMapping("/{executionId}/logs")
    public Result<List<OfflineExecutionLogEntry>> getExecutionLogs(@RequireGroupAuth(Permission.OFFLINE_READ) AuthContextResponse context,
                                                                   @PathVariable String executionId,
                                                                   @RequestParam(required = false) String taskId) {
        return Result.success(offlineExecutionService.getExecutionLogs(context.currentGroup().id(), executionId, taskId));
    }

    @Operation(summary = "停止单个执行")
    @PostMapping("/{executionId}/stop")
    public Result<Void> stopExecution(@RequireGroupAuth(Permission.OFFLINE_WRITE) AuthContextResponse context,
                                      @PathVariable String executionId) {
        offlineExecutionService.stopExecution(context.currentGroup().id(), executionId);
        return Result.success(null);
    }

    @Operation(summary = "停止当前 Flow 所有运行中的执行")
    @PostMapping("/stop-all")
    public Result<Integer> stopAllExecutions(@RequireGroupAuth(Permission.OFFLINE_WRITE) AuthContextResponse context,
                                             @RequestParam String flowPath) {
        return Result.success(offlineExecutionService.stopAllExecutions(context.currentGroup().id(), flowPath));
    }

}
