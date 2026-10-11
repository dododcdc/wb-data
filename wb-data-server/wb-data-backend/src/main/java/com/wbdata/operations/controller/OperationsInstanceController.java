package com.wbdata.operations.controller;

import com.wbdata.auth.context.GroupAuthContext;
import com.wbdata.auth.context.RequireGroupAuth;
import com.wbdata.auth.enums.Permission;
import com.wbdata.auth.service.AuthContextService;
import com.wbdata.common.Result;
import com.wbdata.operations.dto.OperationsInstanceDiagnosisResponse;
import com.wbdata.operations.service.OperationsInstanceDiagnosisService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping({"/api/v1/operations/instances", "/api/v1/groups/{groupId}/operations/instances"})
@RequiredArgsConstructor
public class OperationsInstanceController {

    private final OperationsInstanceDiagnosisService diagnosisService;
    private final AuthContextService authContextService;

    @GetMapping("/diagnosis")
    public Result<OperationsInstanceDiagnosisResponse> diagnose(
            @RequireGroupAuth(Permission.OFFLINE_READ) GroupAuthContext context,
            @RequestParam(required = false) String branch,
            @RequestParam(required = false) String flowId,
            @RequestParam(required = false) String scheduleKey,
            @RequestParam(required = false) String executionId) {
        if (executionId != null && !executionId.isBlank()) {
            return Result.success(diagnosisService.diagnoseByExecution(
                    context.groupId(),
                    executionId,
                    authContextService.listAccessibleGroups(context.user())
            ));
        }
        return Result.success(diagnosisService.diagnose(
                context.groupId(),
                branch,
                flowId,
                scheduleKey,
                authContextService.listAccessibleGroups(context.user())
        ));
    }
}
