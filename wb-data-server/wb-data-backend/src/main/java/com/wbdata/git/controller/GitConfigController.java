package com.wbdata.git.controller;

import com.wbdata.auth.context.AuthContext;
import com.wbdata.auth.dto.AuthContextResponse;
import com.wbdata.auth.service.AuthSession;
import com.wbdata.auth.service.AuthContextService;
import com.wbdata.common.Result;
import com.wbdata.git.dto.GitConfigResponse;
import com.wbdata.git.dto.SaveGitConfigRequest;
import com.wbdata.git.entity.WbGitConfig;
import com.wbdata.git.service.GitConfigService;
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
    private final AuthContextService authContextService;

    @GetMapping
    public Result<GitConfigResponse> getConfig(@RequestParam Long groupId) {
        AuthContextResponse context = requireGroupContext(groupId, "offline.read");
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

    @PostMapping
    public Result<Void> saveConfig(@RequestParam Long groupId, @Valid @RequestBody SaveGitConfigRequest request) {
        AuthContextResponse context = requireGroupContext(groupId, "offline.write");
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
    public Result<Void> deleteConfig(@RequestParam Long groupId) {
        AuthContextResponse context = requireGroupContext(groupId, "offline.write");
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

    private AuthContextResponse requireGroupContext(Long groupId, String permission) {
        AuthSession session = AuthContext.require();
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
