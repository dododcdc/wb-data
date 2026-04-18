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

@Service
@RequiredArgsConstructor
public class OfflineScheduleService {

    private final OfflineFlowContentService offlineFlowContentService;
    private final OfflineFlowYamlSupport yamlSupport = new OfflineFlowYamlSupport();

    public OfflineScheduleResponse getSchedule(Long groupId, String path) {
        OfflineFlowContentResponse current = offlineFlowContentService.getFlowContent(groupId, path);
        OfflineFlowYamlSupport.ScheduleData schedule = yamlSupport.readSchedule(current.content());
        if (schedule == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Flow 尚未配置调度");
        }
        return toResponse(groupId, path, current, schedule);
    }

    public OfflineScheduleResponse updateSchedule(UpdateOfflineScheduleRequest request) {
        OfflineFlowContentResponse current = offlineFlowContentService.saveFlowContent(new SaveOfflineFlowRequest(
                request.groupId(),
                request.path(),
                yamlSupport.updateSchedule(
                        offlineFlowContentService.getFlowContent(request.groupId(), request.path()).content(),
                        request.cron(),
                        request.timezone()
                ),
                request.contentHash(),
                request.fileUpdatedAt()
        ));
        OfflineFlowYamlSupport.ScheduleData schedule = yamlSupport.readSchedule(current.content());
        return toResponse(request.groupId(), request.path(), current, schedule);
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
