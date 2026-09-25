package com.wbdata.offline.controller;

import com.wbdata.auth.context.AuthContext;
import com.wbdata.auth.context.RequireGroupAuth;
import com.wbdata.auth.context.GroupAuthContext;
import com.wbdata.auth.enums.Permission;
import com.wbdata.auth.service.AuthContextService;
import com.wbdata.auth.service.AuthSession;
import com.wbdata.common.Result;
import com.wbdata.offline.dto.DeleteOfflineFlowRequest;
import com.wbdata.offline.dto.OfflineFlowDocumentResponse;
import com.wbdata.offline.dto.OfflineFlowContentResponse;
import com.wbdata.offline.dto.MoveOfflineFlowRequest;
import com.wbdata.offline.dto.SaveOfflineFlowDocumentRequest;
import com.wbdata.offline.dto.SaveOfflineFlowRequest;
import com.wbdata.offline.service.OfflineFlowContentService;
import com.wbdata.offline.service.OfflineFlowDependencyService;
import com.wbdata.offline.service.OfflineFlowDocumentService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@Tag(name = "离线开发", description = "任务内容读写")
@RestController
@RequestMapping({"/api/v1/offline/flows", "/api/v1/groups/{groupId}/offline/flows"})
@RequiredArgsConstructor
public class OfflineFlowController {

    private final OfflineFlowContentService offlineFlowContentService;
    private final OfflineFlowDocumentService offlineFlowDocumentService;
    private final OfflineFlowDependencyService offlineFlowDependencyService;
    private final AuthContextService authContextService;

    @Operation(summary = "读取任务内容")
    @GetMapping("/content")
    public Result<OfflineFlowContentResponse> getFlowContent(@RequireGroupAuth(Permission.OFFLINE_READ) GroupAuthContext context,
                                                             @RequestParam String path) {
        return Result.success(offlineFlowContentService.getFlowContent(context.groupId(), path));
    }

    @Operation(summary = "保存任务内容")
    @PutMapping("/content")
    public Result<OfflineFlowContentResponse> saveFlowContent(@RequireGroupAuth(Permission.OFFLINE_WRITE) GroupAuthContext context,
                                                              @Valid @RequestBody SaveOfflineFlowRequest request) {
        SaveOfflineFlowRequest normalizedRequest = new SaveOfflineFlowRequest(
                context.groupId(),
                request.path(),
                request.content(),
                request.contentHash(),
                request.fileUpdatedAt()
        );
        return Result.success(offlineFlowContentService.saveFlowContent(normalizedRequest));
    }

    @Operation(summary = "读取结构化任务文档")
    @GetMapping("/document")
    public Result<OfflineFlowDocumentResponse> getFlowDocument(@RequireGroupAuth(Permission.OFFLINE_READ) GroupAuthContext context,
                                                               @RequestParam String path) {
        return Result.success(offlineFlowDocumentService.getFlowDocument(context.groupId(), path));
    }

    @Operation(summary = "保存结构化任务文档")
    @PutMapping("/document")
    public Result<OfflineFlowDocumentResponse> saveFlowDocument(@RequireGroupAuth(Permission.OFFLINE_WRITE) GroupAuthContext context,
                                                                @Valid @RequestBody SaveOfflineFlowDocumentRequest request) {
        SaveOfflineFlowDocumentRequest normalizedRequest = new SaveOfflineFlowDocumentRequest(
                context.groupId(),
                request.path(),
                request.documentHash(),
                request.documentUpdatedAt(),
                request.stages(),
                request.edges(),
                request.layout(),
                request.schedule(),
                request.parameterBinding(),
                request.parameterBindings(),
                request.runtimeTimezone(),
                request.dependencyConfig()
        );
        return Result.success(offlineFlowDependencyService.saveDocument(normalizedRequest, authContextService.listAccessibleGroups(context.user()),
                () -> offlineFlowDocumentService.saveFlowDocument(normalizedRequest)));
    }

    @Operation(summary = "删除任务（物理删除）")
    @DeleteMapping
    public Result<Void> deleteFlow(@RequireGroupAuth(Permission.OFFLINE_WRITE) GroupAuthContext context,
                                   @Valid @RequestBody DeleteOfflineFlowRequest request) {
        return offlineFlowDependencyService.withDependencyGraphLock(() -> {
            offlineFlowDependencyService.assertDeletionAllowed(
                    context.groupId(), request.path(), authContextService.listAccessibleGroups(context.user()));
            offlineFlowContentService.deleteFlow(context.groupId(), request.path());
            return Result.success(null);
        });
    }

    @Operation(summary = "移动任务（含跨目录，重命名视为同目录移动）")
    @PostMapping("/move")
    public Result<Void> moveFlow(@RequireGroupAuth(Permission.OFFLINE_WRITE) GroupAuthContext context,
                                 @Valid @RequestBody MoveOfflineFlowRequest request) {
        offlineFlowContentService.moveFlow(context.groupId(), request.path(), request.newPath());
        return Result.success(null);
    }

}
