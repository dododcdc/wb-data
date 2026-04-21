package com.wbdata.offline.controller;

import com.wbdata.auth.context.AuthContext;
import com.wbdata.auth.context.RequireGroupAuth;
import com.wbdata.auth.dto.AuthContextResponse;
import com.wbdata.auth.enums.Permission;
import com.wbdata.auth.service.AuthSession;
import com.wbdata.common.Result;
import com.wbdata.offline.dto.CreateFolderRequest;
import com.wbdata.offline.dto.DeleteFolderRequest;
import com.wbdata.offline.dto.CommitRequest;
import com.wbdata.offline.dto.CommitResponse;
import com.wbdata.offline.dto.OfflineRepoStatusResponse;
import com.wbdata.offline.dto.OfflineRepoTreeResponse;
import com.wbdata.offline.dto.PushRequest;
import com.wbdata.offline.dto.PushResponse;
import com.wbdata.offline.dto.RemoteStatusResponse;
import com.wbdata.offline.dto.RenameFolderRequest;
import com.wbdata.offline.service.GitPushService;
import com.wbdata.offline.service.OfflineRepoStatusService;
import com.wbdata.offline.service.OfflineRepoTreeService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@Tag(name = "离线开发", description = "离线开发模块基础能力")
@RestController
@RequestMapping("/api/v1/offline")
@RequiredArgsConstructor
public class OfflineRepoController {

    private final OfflineRepoStatusService offlineRepoStatusService;
    private final OfflineRepoTreeService offlineRepoTreeService;
    private final GitPushService gitPushService;

    @Operation(summary = "获取项目组离线仓库状态")
    @GetMapping("/repo/status")
    public Result<OfflineRepoStatusResponse> getRepoStatus(@RequireGroupAuth(Permission.OFFLINE_READ) AuthContextResponse context) {
        return Result.success(offlineRepoStatusService.getRepoStatus(context.currentGroup().id()));
    }

    @Operation(summary = "获取项目组离线仓库目录树")
    @GetMapping("/repo/tree")
    public Result<OfflineRepoTreeResponse> getRepoTree(@RequireGroupAuth(Permission.OFFLINE_READ) AuthContextResponse context) {
        return Result.success(offlineRepoTreeService.getRepoTree(context.currentGroup().id(), context.currentGroup().name()));
    }

    @Operation(summary = "获取远程仓库关联状态")
    @GetMapping("/repo/remote")
    public Result<RemoteStatusResponse> getRemoteStatus(@RequireGroupAuth(Permission.OFFLINE_READ) AuthContextResponse context) {
        boolean hasRemote = gitPushService.hasRemote(context.currentGroup().id());
        String remoteUrl = hasRemote ? gitPushService.getRemoteUrl(context.currentGroup().id()) : null;
        return Result.success(new RemoteStatusResponse(hasRemote, remoteUrl));
    }

    @Operation(summary = "提交本地更改打标版本")
    @PostMapping("/repo/commit")
    public Result<CommitResponse> commit(@RequireGroupAuth(Permission.OFFLINE_WRITE) AuthContextResponse context,
                                         @Valid @RequestBody CommitRequest request) {
        GitPushService.CommitResult result = gitPushService.commit(context.currentGroup().id(), request.message());
        return Result.success(new CommitResponse(result.success(), result.message()));
    }

    @Operation(summary = "推送本地仓库到 GitHub")
    @PostMapping("/repo/push")
    public Result<PushResponse> push(@RequireGroupAuth(Permission.OFFLINE_WRITE) AuthContextResponse context,
                                     @Valid @RequestBody PushRequest request) {
        GitPushService.PushResult result = gitPushService.push(context.currentGroup().id());
        return Result.success(new PushResponse(result.success(), result.message(), result.remoteUrl(), result.remoteCreated()));
    }

    @Operation(summary = "在离线仓库中创建文件夹")
    @PostMapping("/repo/folder")
    public Result<Void> createFolder(@RequireGroupAuth(Permission.OFFLINE_WRITE) AuthContextResponse context,
                                     @Valid @RequestBody CreateFolderRequest request) {
        offlineRepoTreeService.createFolder(new CreateFolderRequest(context.currentGroup().id(), request.path()));
        return Result.success(null);
    }

    @Operation(summary = "删除离线仓库中的文件夹")
    @DeleteMapping("/repo/folder")
    public Result<Void> deleteFolder(@RequireGroupAuth(Permission.OFFLINE_WRITE) AuthContextResponse context,
                                     @Valid @RequestBody DeleteFolderRequest request) {
        offlineRepoTreeService.deleteFolder(context.currentGroup().id(), request.path());
        return Result.success(null);
    }

    @Operation(summary = "重命名离线仓库中的文件夹")
    @PostMapping("/repo/folder/rename")
    public Result<Void> renameFolder(@RequireGroupAuth(Permission.OFFLINE_WRITE) AuthContextResponse context,
                                     @Valid @RequestBody RenameFolderRequest request) {
        offlineRepoTreeService.renameFolder(context.currentGroup().id(), request.path(), request.newName());
        return Result.success(null);
    }

}
