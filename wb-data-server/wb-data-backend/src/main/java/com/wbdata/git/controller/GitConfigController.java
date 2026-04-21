package com.wbdata.git.controller;

import com.wbdata.auth.context.RequireGroupAuth;
import com.wbdata.auth.dto.AuthContextResponse;
import com.wbdata.auth.enums.Permission;
import com.wbdata.common.Result;
import com.wbdata.git.dto.GitConfigResponse;
import com.wbdata.git.dto.SaveGitConfigRequest;
import com.wbdata.git.entity.WbGitConfig;
import com.wbdata.git.service.GitConfigService;
import io.swagger.v3.oas.annotations.Operation;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/git/config")
@RequiredArgsConstructor
public class GitConfigController {

    private final GitConfigService gitConfigService;

    @GetMapping
    public Result<GitConfigResponse> getConfig(@RequireGroupAuth(Permission.OFFLINE_READ) AuthContextResponse context) {
        WbGitConfig config = gitConfigService.getConfig(context.currentGroup().id());
        if (config == null) {
            return Result.success(null);
        }
        return Result.success(new GitConfigResponse(
                config.getId(),
                config.getProvider(),
                config.getUsername(),
                config.getToken(),
                config.getBaseUrl()
        ));
    }

    @Operation(summary = "保存 Git 配置")
    @PostMapping
    public Result<Void> saveConfig(@RequireGroupAuth(Permission.OFFLINE_WRITE) AuthContextResponse context,
                                   @Valid @RequestBody SaveGitConfigRequest request) {
        gitConfigService.saveConfig(
                context.currentGroup().id(),
                request.provider(),
                request.username(),
                request.token(),
                request.baseUrl(),
                context.user().id()
        );
        return Result.success(null);
    }

    @DeleteMapping
    public Result<Void> deleteConfig(@RequireGroupAuth(Permission.OFFLINE_WRITE) AuthContextResponse context) {
        gitConfigService.deleteConfig(context.currentGroup().id());
        return Result.success(null);
    }

    @PostMapping("/test")
    public Result<String> testConnection(@Valid @RequestBody SaveGitConfigRequest request) {
        String result = gitConfigService.testConnection(
                request.provider(),
                request.username(),
                request.token(),
                request.baseUrl()
        );
        return Result.success(result);
    }

}
