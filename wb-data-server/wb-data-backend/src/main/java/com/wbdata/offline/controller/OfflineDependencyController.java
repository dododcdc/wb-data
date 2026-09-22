package com.wbdata.offline.controller;

import com.wbdata.auth.context.RequireGroupAuth;
import com.wbdata.auth.dto.AuthContextResponse;
import com.wbdata.auth.enums.Permission;
import com.wbdata.common.Result;
import com.wbdata.offline.dto.OfflineDependencyCandidateResponse;
import com.wbdata.offline.dto.OfflineDependencyConfigResponse;
import com.wbdata.offline.dto.OfflineDependentItemResponse;
import com.wbdata.offline.dto.UpdateOfflineDependenciesRequest;
import com.wbdata.offline.service.OfflineFlowDependencyService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@Tag(name = "离线开发", description = "任务依赖配置")
@RestController
@RequestMapping({"/api/v1/offline/dependencies", "/api/v1/groups/{groupId}/offline/dependencies"})
@RequiredArgsConstructor
public class OfflineDependencyController {

    private final OfflineFlowDependencyService offlineFlowDependencyService;

    @Operation(summary = "读取任务依赖配置")
    @GetMapping
    public Result<OfflineDependencyConfigResponse> getDependencies(@RequireGroupAuth(Permission.OFFLINE_READ) AuthContextResponse context,
                                                                   @RequestParam String path) {
        return Result.success(offlineFlowDependencyService.getConfig(
                context.currentGroup().id(), path, context.accessibleGroups()));
    }

    @Operation(summary = "更新任务依赖配置")
    @PutMapping
    public Result<OfflineDependencyConfigResponse> updateDependencies(@RequireGroupAuth(Permission.OFFLINE_WRITE) AuthContextResponse context,
                                                                      @Valid @RequestBody UpdateOfflineDependenciesRequest request) {
        UpdateOfflineDependenciesRequest normalizedRequest = new UpdateOfflineDependenciesRequest(
                context.currentGroup().id(),
                request.path(),
                request.dependencies(),
                request.failurePolicy(),
                request.crossGroupDependency(),
                request.contentHash(),
                request.fileUpdatedAt()
        );
        return Result.success(offlineFlowDependencyService.updateConfig(normalizedRequest, context.accessibleGroups()));
    }

    @Operation(summary = "搜索可依赖的前置任务")
    @GetMapping("/candidates")
    public Result<List<OfflineDependencyCandidateResponse>> searchCandidates(@RequireGroupAuth(Permission.OFFLINE_READ) AuthContextResponse context,
                                                                             @RequestParam String path,
                                                                             @RequestParam(required = false) String keyword) {
        return Result.success(offlineFlowDependencyService.searchCandidates(
                context.currentGroup().id(), path, keyword, context.accessibleGroups()));
    }

    @Operation(summary = "查询依赖当前任务的下游任务")
    @GetMapping("/dependents")
    public Result<List<OfflineDependentItemResponse>> findDependents(@RequireGroupAuth(Permission.OFFLINE_READ) AuthContextResponse context,
                                                                     @RequestParam String path) {
        return Result.success(offlineFlowDependencyService.findDependents(
                context.currentGroup().id(), path, context.accessibleGroups()));
    }

}
