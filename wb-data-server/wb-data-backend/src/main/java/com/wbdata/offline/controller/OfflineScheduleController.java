package com.wbdata.offline.controller;

import com.wbdata.auth.context.AuthContext;
import com.wbdata.auth.context.RequireGroupAuth;
import com.wbdata.auth.dto.AuthContextResponse;
import com.wbdata.auth.enums.Permission;
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

    private final OfflineScheduleService offlineScheduleService;

    @Operation(summary = "读取 Flow 调度配置")
    @GetMapping
    public Result<OfflineScheduleResponse> getSchedule(@RequireGroupAuth(Permission.OFFLINE_READ) AuthContextResponse context,
                                                       @RequestParam String path) {
        return Result.success(offlineScheduleService.getSchedule(context.currentGroup().id(), path));
    }

    @Operation(summary = "更新 Flow 调度配置")
    @PutMapping
    public Result<OfflineScheduleResponse> updateSchedule(@RequireGroupAuth(Permission.OFFLINE_WRITE) AuthContextResponse context,
                                                          @Valid @RequestBody UpdateOfflineScheduleRequest request) {
        return Result.success(offlineScheduleService.updateSchedule(request));
    }

    @Operation(summary = "启用/停用 Flow 调度")
    @PatchMapping("/status")
    public Result<OfflineScheduleResponse> updateScheduleStatus(@RequireGroupAuth(Permission.OFFLINE_WRITE) AuthContextResponse context,
                                                                @Valid @RequestBody UpdateOfflineScheduleStatusRequest request) {
        return Result.success(offlineScheduleService.updateScheduleStatus(request));
    }

}
