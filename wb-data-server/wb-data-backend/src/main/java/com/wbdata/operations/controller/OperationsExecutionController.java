package com.wbdata.operations.controller;

import com.wbdata.auth.context.RequireGroupAuth;
import com.wbdata.auth.context.GroupAuthContext;
import com.wbdata.auth.enums.Permission;
import com.wbdata.common.Result;
import com.wbdata.operations.dto.OperationsExecutionDetailResponse;
import com.wbdata.operations.dto.OperationsExecutionListResponse;
import com.wbdata.offline.execution.dto.ExecutionLogEntry;
import com.wbdata.operations.dto.OperationsExecutionQuery;
import com.wbdata.operations.dto.OperationsExecutionRerunContextResponse;
import com.wbdata.operations.dto.OperationsExecutionRerunRequest;
import com.wbdata.operations.dto.OperationsExecutionRerunResponse;
import com.wbdata.operations.service.OperationsExecutionService;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.List;

@RestController
@RequestMapping({"/api/v1/operations/executions", "/api/v1/groups/{groupId}/operations/executions"})
@RequiredArgsConstructor
public class OperationsExecutionController {

    private final OperationsExecutionService operationsExecutionService;

    @GetMapping
    public Result<OperationsExecutionListResponse> listExecutions(
            @RequireGroupAuth(Permission.OFFLINE_READ) GroupAuthContext context,
            @RequestParam(required = false) String branch,
            @RequestParam(required = false) String flowId,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) Long ownerUserId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer pageSize) {
        return Result.success(operationsExecutionService.listExecutions(
                context.groupId(),
                new OperationsExecutionQuery(branch, flowId, status, from, to, page, pageSize, ownerUserId)
        ));
    }

    @GetMapping("/{executionId}")
    public Result<OperationsExecutionDetailResponse> getExecution(
            @RequireGroupAuth(Permission.OFFLINE_READ) GroupAuthContext context,
            @PathVariable String executionId) {
        return Result.success(operationsExecutionService.getExecution(context.groupId(), executionId));
    }

    @GetMapping("/{executionId}/logs")
    public Result<List<ExecutionLogEntry>> getLogs(
            @RequireGroupAuth(Permission.OFFLINE_READ) GroupAuthContext context,
            @PathVariable String executionId,
            @RequestParam(required = false) String taskId) {
        return Result.success(operationsExecutionService.getLogs(context.groupId(), executionId, taskId));
    }

    @GetMapping("/{executionId}/rerun-context")
    public Result<OperationsExecutionRerunContextResponse> getRerunContext(
            @RequireGroupAuth(Permission.OFFLINE_READ) GroupAuthContext context,
            @PathVariable String executionId) {
        return Result.success(operationsExecutionService.getRerunContext(context.groupId(), executionId));
    }

    @PostMapping("/{executionId}/rerun")
    public Result<OperationsExecutionRerunResponse> rerun(
            @RequireGroupAuth(Permission.OFFLINE_WRITE) GroupAuthContext context,
            @PathVariable String executionId,
            @RequestBody(required = false) OperationsExecutionRerunRequest request) {
        boolean reuseManualOverrides = request != null && request.reuseManualOverrides();
        List<String> selectedTaskIds = request == null ? null : request.selectedTaskIds();
        return Result.success(operationsExecutionService.rerunExecution(
                context.groupId(),
                context.user().id(),
                executionId,
                reuseManualOverrides,
                selectedTaskIds
        ));
    }

    @PostMapping("/{executionId}/stop")
    public Result<Void> stop(
            @RequireGroupAuth(Permission.OFFLINE_WRITE) GroupAuthContext context,
            @PathVariable String executionId) {
        operationsExecutionService.stopExecution(
                context.groupId(),
                context.user().id(),
                executionId
        );
        return Result.success(null);
    }

    @PostMapping("/{executionId}/mark-success")
    public Result<Void> markSuccess(
            @RequireGroupAuth(Permission.OFFLINE_WRITE) GroupAuthContext context,
            @PathVariable String executionId) {
        String displayName = context.user().displayName();
        String operatorName = displayName != null && !displayName.isBlank()
                ? displayName
                : context.user().username();
        operationsExecutionService.markExecutionSuccess(
                context.groupId(),
                context.user().id(),
                operatorName,
                executionId
        );
        return Result.success(null);
    }
}
