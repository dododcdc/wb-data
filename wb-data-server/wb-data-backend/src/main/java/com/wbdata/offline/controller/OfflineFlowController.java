package com.wbdata.offline.controller;

import com.wbdata.auth.context.AuthContext;
import com.wbdata.auth.dto.AuthContextResponse;
import com.wbdata.auth.enums.Permission;
import com.wbdata.auth.service.AuthContextService;
import com.wbdata.auth.service.AuthSession;
import com.wbdata.common.Result;
import com.wbdata.offline.dto.DeleteOfflineFlowRequest;
import com.wbdata.offline.dto.OfflineFlowDocumentResponse;
import com.wbdata.offline.dto.OfflineFlowContentResponse;
import com.wbdata.offline.dto.RenameOfflineFlowRequest;
import com.wbdata.offline.dto.SaveOfflineFlowDocumentRequest;
import com.wbdata.offline.dto.SaveOfflineFlowRequest;
import com.wbdata.offline.service.OfflineFlowContentService;
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

@Tag(name = "离线开发", description = "Flow 内容读写")
@RestController
@RequestMapping("/api/v1/offline/flows")
@RequiredArgsConstructor
public class OfflineFlowController {

    private final AuthContextService authContextService;
    private final OfflineFlowContentService offlineFlowContentService;
    private final OfflineFlowDocumentService offlineFlowDocumentService;

    @Operation(summary = "读取 Flow 内容")
    @GetMapping("/content")
    public Result<OfflineFlowContentResponse> getFlowContent(@RequestParam Long groupId,
                                                             @RequestParam String path) {
        AuthContextResponse context = requireGroupContext(groupId, Permission.OFFLINE_READ.code());
        return Result.success(offlineFlowContentService.getFlowContent(context.currentGroup().id(), path));
    }

    @Operation(summary = "保存 Flow 内容")
    @PutMapping("/content")
    public Result<OfflineFlowContentResponse> saveFlowContent(@Valid @RequestBody SaveOfflineFlowRequest request) {
        AuthContextResponse context = requireGroupContext(request.groupId(), Permission.OFFLINE_WRITE.code());
        SaveOfflineFlowRequest normalizedRequest = new SaveOfflineFlowRequest(
                context.currentGroup().id(),
                request.path(),
                request.content(),
                request.contentHash(),
                request.fileUpdatedAt()
        );
        return Result.success(offlineFlowContentService.saveFlowContent(normalizedRequest));
    }

    @Operation(summary = "读取结构化 Flow 文档")
    @GetMapping("/document")
    public Result<OfflineFlowDocumentResponse> getFlowDocument(@RequestParam Long groupId,
                                                               @RequestParam String path) {
        AuthContextResponse context = requireGroupContext(groupId, Permission.OFFLINE_READ.code());
        return Result.success(offlineFlowDocumentService.getFlowDocument(context.currentGroup().id(), path));
    }

    @Operation(summary = "保存结构化 Flow 文档")
    @PutMapping("/document")
    public Result<OfflineFlowDocumentResponse> saveFlowDocument(@Valid @RequestBody SaveOfflineFlowDocumentRequest request) {
        AuthContextResponse context = requireGroupContext(request.groupId(), Permission.OFFLINE_WRITE.code());
        SaveOfflineFlowDocumentRequest normalizedRequest = new SaveOfflineFlowDocumentRequest(
                context.currentGroup().id(),
                request.path(),
                request.documentHash(),
                request.documentUpdatedAt(),
                request.stages(),
                request.edges(),
                request.layout()
        );
        return Result.success(offlineFlowDocumentService.saveFlowDocument(normalizedRequest));
    }

    @Operation(summary = "删除 Flow（物理删除）")
    @DeleteMapping
    public Result<Void> deleteFlow(@Valid @RequestBody DeleteOfflineFlowRequest request) {
        AuthContextResponse context = requireGroupContext(request.groupId(), Permission.OFFLINE_WRITE.code());
        offlineFlowContentService.deleteFlow(context.currentGroup().id(), request.path());
        return Result.success(null);
    }

    @Operation(summary = "重命名 Flow")
    @PostMapping("/rename")
    public Result<Void> renameFlow(@Valid @RequestBody RenameOfflineFlowRequest request) {
        AuthContextResponse context = requireGroupContext(request.groupId(), Permission.OFFLINE_WRITE.code());
        RenameOfflineFlowRequest normalizedRequest = new RenameOfflineFlowRequest(
                context.currentGroup().id(),
                request.path(),
                request.newName()
        );
        offlineFlowContentService.renameFlow(normalizedRequest.groupId(), normalizedRequest.path(), normalizedRequest.newName());
        return Result.success(null);
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
