package com.wbdata.operations.controller;

import com.wbdata.auth.context.RequireGroupAuth;
import com.wbdata.auth.dto.AuthContextResponse;
import com.wbdata.auth.enums.Permission;
import com.wbdata.common.Result;
import com.wbdata.operations.dto.OperationsExecutionDetailResponse;
import com.wbdata.operations.dto.OperationsExecutionListResponse;
import com.wbdata.operations.dto.OperationsExecutionLogEntry;
import com.wbdata.operations.dto.OperationsExecutionQuery;
import com.wbdata.operations.dto.OperationsExecutionRerunResponse;
import com.wbdata.operations.service.OperationsExecutionService;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.List;

@RestController
@RequestMapping("/api/v1/operations/executions")
@RequiredArgsConstructor
public class OperationsExecutionController {

    private final OperationsExecutionService operationsExecutionService;

    @GetMapping
    public Result<OperationsExecutionListResponse> listExecutions(
            @RequireGroupAuth(Permission.OFFLINE_READ) AuthContextResponse context,
            @RequestParam(required = false) String branch,
            @RequestParam(required = false) String flowId,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to) {
        return Result.success(operationsExecutionService.listExecutions(
                context.currentGroup().id(),
                new OperationsExecutionQuery(branch, flowId, status, from, to)
        ));
    }

    @GetMapping("/{executionId}")
    public Result<OperationsExecutionDetailResponse> getExecution(
            @RequireGroupAuth(Permission.OFFLINE_READ) AuthContextResponse context,
            @PathVariable String executionId) {
        return Result.success(operationsExecutionService.getExecution(context.currentGroup().id(), executionId));
    }

    @GetMapping("/{executionId}/logs")
    public Result<List<OperationsExecutionLogEntry>> getLogs(
            @RequireGroupAuth(Permission.OFFLINE_READ) AuthContextResponse context,
            @PathVariable String executionId,
            @RequestParam(required = false) String taskId) {
        return Result.success(operationsExecutionService.getLogs(context.currentGroup().id(), executionId, taskId));
    }

    @PostMapping("/{executionId}/rerun")
    public Result<OperationsExecutionRerunResponse> rerun(
            @RequireGroupAuth(Permission.OFFLINE_WRITE) AuthContextResponse context,
            @PathVariable String executionId) {
        return Result.success(operationsExecutionService.rerunExecution(
                context.currentGroup().id(),
                context.user().id(),
                executionId
        ));
    }
}
