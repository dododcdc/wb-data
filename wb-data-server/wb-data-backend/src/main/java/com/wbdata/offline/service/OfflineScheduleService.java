package com.wbdata.offline.service;

import com.wbdata.offline.dto.OfflineFlowContentResponse;
import com.wbdata.offline.dto.OfflineScheduleResponse;
import com.wbdata.offline.dto.SaveOfflineFlowRequest;
import com.wbdata.offline.dto.UpdateOfflineScheduleRequest;
import com.wbdata.offline.dto.UpdateOfflineScheduleStatusRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.ZoneId;

@Service
@RequiredArgsConstructor
public class OfflineScheduleService {

    private final OfflineFlowContentService offlineFlowContentService;
    private final OfflineFlowYamlSupport yamlSupport = new OfflineFlowYamlSupport();

    public OfflineScheduleResponse getSchedule(Long groupId, String path) {
        OfflineFlowContentResponse current = offlineFlowContentService.getFlowContent(groupId, path);
        OfflineFlowYamlSupport.ScheduleData schedule = yamlSupport.readSchedule(current.content());
        if (schedule == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "任务尚未配置调度");
        }
        return toResponse(groupId, path, current, schedule);
    }

    public OfflineScheduleResponse updateSchedule(UpdateOfflineScheduleRequest request) {
        OfflineFlowContentResponse existing = offlineFlowContentService.getFlowContent(
                request.groupId(), request.path());
        String runtimeTimezone = requireRuntimeTimezone(existing.content());
        OfflineFlowContentResponse current = offlineFlowContentService.saveFlowContent(new SaveOfflineFlowRequest(
                request.groupId(),
                request.path(),
                yamlSupport.updateSchedule(
                        existing.content(),
                        request.cron(),
                        runtimeTimezone
                ),
                request.contentHash(),
                request.fileUpdatedAt()
        ));
        OfflineFlowYamlSupport.ScheduleData schedule = yamlSupport.readSchedule(current.content());
        return toResponse(request.groupId(), request.path(), current, schedule);
    }

    private String requireRuntimeTimezone(String flowSource) {
        String runtimeTimezone = yamlSupport.readLabel(flowSource, "wbdataRuntimeTimezone");
        if (runtimeTimezone == null || runtimeTimezone.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "任务运行时区不能为空");
        }
        String normalized = runtimeTimezone.trim();
        try {
            ZoneId.of(normalized);
        } catch (RuntimeException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "任务运行时区不合法");
        }
        return normalized;
    }

    public OfflineScheduleResponse updateScheduleStatus(UpdateOfflineScheduleStatusRequest request) {
        OfflineFlowContentResponse currentFlow = offlineFlowContentService.getFlowContent(request.groupId(), request.path());
        OfflineFlowContentResponse saved = offlineFlowContentService.saveFlowContent(new SaveOfflineFlowRequest(
                request.groupId(),
                request.path(),
                yamlSupport.updateScheduleStatus(currentFlow.content(), request.enabled()),
                request.contentHash(),
                request.fileUpdatedAt()
        ));
        OfflineFlowYamlSupport.ScheduleData schedule = yamlSupport.readSchedule(saved.content());
        return toResponse(request.groupId(), request.path(), saved, schedule);
    }

    private OfflineScheduleResponse toResponse(Long groupId,
                                               String path,
                                               OfflineFlowContentResponse flow,
                                               OfflineFlowYamlSupport.ScheduleData schedule) {
        return new OfflineScheduleResponse(
                groupId,
                path,
                schedule.triggerId(),
                schedule.cron(),
                schedule.timezone(),
                schedule.enabled(),
                flow.contentHash(),
                flow.fileUpdatedAt()
        );
    }
}
