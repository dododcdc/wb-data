package com.wbdata.offline.controller;

import com.wbdata.auth.context.AuthContext;
import com.wbdata.auth.dto.AuthContextResponse;
import com.wbdata.auth.enums.Permission;
import com.wbdata.auth.service.AuthContextService;
import com.wbdata.auth.service.AuthSession;
import com.wbdata.common.Result;
import com.wbdata.offline.dto.OfflineScheduleResponse;
import com.wbdata.offline.dto.UpdateOfflineScheduleRequest;
import com.wbdata.offline.dto.UpdateOfflineScheduleStatusRequest;
import com.wbdata.offline.service.OfflineScheduleService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@Tag(name = "离线开发", description = "Flow 调度配置")
@RestController
@RequestMapping("/api/v1/offline/schedules")
@RequiredArgsConstructor
public class OfflineScheduleController {

    private final AuthContextService authContextService;
    private final OfflineScheduleService offlineScheduleService;

    @Operation(summary = "读取 Flow 调度配置")
    @GetMapping
    public Result<OfflineScheduleResponse> getSchedule(@RequestParam Long groupId,
                                                       @RequestParam String path) {
        AuthSession session = AuthContext.require();
        requireGroupContext(session, groupId, Permission.OFFLINE_READ.code());
        return Result.success(offlineScheduleService.getSchedule(groupId, path));
    }

    @Operation(summary = "更新 Flow 调度配置")
    @PutMapping
    public Result<OfflineScheduleResponse> updateSchedule(@Valid @RequestBody UpdateOfflineScheduleRequest request) {
        AuthSession session = AuthContext.require();
        requireGroupContext(session, request.groupId(), Permission.OFFLINE_WRITE.code());
        return Result.success(offlineScheduleService.updateSchedule(request));
    }

    @Operation(summary = "启用/停用 Flow 调度")
    @PatchMapping("/status")
    public Result<OfflineScheduleResponse> updateScheduleStatus(@Valid @RequestBody UpdateOfflineScheduleStatusRequest request) {
        AuthSession session = AuthContext.require();
        requireGroupContext(session, request.groupId(), Permission.OFFLINE_WRITE.code());
        return Result.success(offlineScheduleService.updateScheduleStatus(request));
    }

    private AuthContextResponse requireGroupContext(AuthSession session, Long groupId, String permission) {
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
