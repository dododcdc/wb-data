package com.wbdata.git.controller;

import com.wbdata.auth.context.RequireGroupAuth;
import com.wbdata.auth.dto.AuthContextResponse;
import com.wbdata.auth.enums.Permission;
import com.wbdata.common.Result;
import com.wbdata.git.dto.AddAllGitSyncConfigsResponse;
import com.wbdata.git.dto.CreateGitSyncConfigRequest;
import com.wbdata.git.dto.GitSyncConfigListResponse;
import com.wbdata.git.dto.GitSyncConfigResponse;
import com.wbdata.git.dto.TriggerGitSyncResponse;
import com.wbdata.git.dto.UpdateGitSyncConfigStatusRequest;
import com.wbdata.git.service.GitSyncConfigService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/git/sync-config")
@RequiredArgsConstructor
public class GitSyncConfigController {

    private final GitSyncConfigService gitSyncConfigService;

    @GetMapping
    public Result<GitSyncConfigListResponse> list(@RequireGroupAuth(Permission.OFFLINE_READ) AuthContextResponse context) {
        return Result.success(gitSyncConfigService.list(context.currentGroup().id()));
    }

    @PostMapping
    public Result<GitSyncConfigResponse> create(@RequireGroupAuth(Permission.GROUP_SETTINGS) AuthContextResponse context,
                                                @Valid @RequestBody CreateGitSyncConfigRequest request) {
        return Result.success(gitSyncConfigService.create(context.currentGroup().id(), request.branch()));
    }

    @PostMapping("/all-known-branches")
    public Result<AddAllGitSyncConfigsResponse> createAllKnownBranches(@RequireGroupAuth(Permission.GROUP_SETTINGS) AuthContextResponse context) {
        return Result.success(gitSyncConfigService.createAllKnownBranches(context.currentGroup().id()));
    }

    @PatchMapping("/{id}/status")
    public Result<GitSyncConfigResponse> updateStatus(@RequireGroupAuth(Permission.GROUP_SETTINGS) AuthContextResponse context,
                                                      @PathVariable Long id,
                                                      @Valid @RequestBody UpdateGitSyncConfigStatusRequest request) {
        return Result.success(gitSyncConfigService.setEnabled(context.currentGroup().id(), id, request.enabled()));
    }

    @PostMapping("/{id}/trigger")
    public Result<TriggerGitSyncResponse> trigger(@RequireGroupAuth(Permission.GROUP_SETTINGS) AuthContextResponse context,
                                                  @PathVariable Long id) {
        return Result.success(gitSyncConfigService.trigger(context.currentGroup().id(), id));
    }

    @DeleteMapping("/{id}")
    public Result<Void> delete(@RequireGroupAuth(Permission.GROUP_SETTINGS) AuthContextResponse context,
                               @PathVariable Long id) {
        gitSyncConfigService.delete(context.currentGroup().id(), id);
        return Result.success(null);
    }
}
