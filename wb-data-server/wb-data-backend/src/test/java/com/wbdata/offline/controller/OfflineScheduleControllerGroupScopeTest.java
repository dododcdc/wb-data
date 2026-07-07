package com.wbdata.offline.controller;

import com.wbdata.auth.dto.AuthContextResponse;
import com.wbdata.auth.dto.CurrentUserResponse;
import com.wbdata.auth.dto.ProjectGroupContextItem;
import com.wbdata.offline.dto.OfflineScheduleResponse;
import com.wbdata.offline.dto.UpdateOfflineScheduleRequest;
import com.wbdata.offline.dto.UpdateOfflineScheduleStatusRequest;
import com.wbdata.offline.service.OfflineScheduleService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class OfflineScheduleControllerGroupScopeTest {

    @Test
    void updateScheduleUsesAuthenticatedGroupInsteadOfBodyGroup() {
        OfflineScheduleService service = mock(OfflineScheduleService.class);
        when(service.updateSchedule(any())).thenReturn(response(4L));
        OfflineScheduleController controller = new OfflineScheduleController(service);

        controller.updateSchedule(context(4L), new UpdateOfflineScheduleRequest(
                999L,
                "_flows/jack/test/flow.yaml",
                "* * * * *",
                "Asia/Singapore",
                "hash",
                100L
        ));

        ArgumentCaptor<UpdateOfflineScheduleRequest> captor = ArgumentCaptor.forClass(UpdateOfflineScheduleRequest.class);
        verify(service).updateSchedule(captor.capture());
        assertThat(captor.getValue().groupId()).isEqualTo(4L);
    }

    @Test
    void updateScheduleStatusUsesAuthenticatedGroupInsteadOfBodyGroup() {
        OfflineScheduleService service = mock(OfflineScheduleService.class);
        when(service.updateScheduleStatus(any())).thenReturn(response(4L));
        OfflineScheduleController controller = new OfflineScheduleController(service);

        controller.updateScheduleStatus(context(4L), new UpdateOfflineScheduleStatusRequest(
                999L,
                "_flows/jack/test/flow.yaml",
                true,
                "hash",
                100L
        ));

        ArgumentCaptor<UpdateOfflineScheduleStatusRequest> captor = ArgumentCaptor.forClass(UpdateOfflineScheduleStatusRequest.class);
        verify(service).updateScheduleStatus(captor.capture());
        assertThat(captor.getValue().groupId()).isEqualTo(4L);
    }

    private AuthContextResponse context(Long groupId) {
        ProjectGroupContextItem group = new ProjectGroupContextItem(groupId, "policy", "", "GROUP_ADMIN");
        return new AuthContextResponse(
                new CurrentUserResponse(1L, "admin", "admin", "ADMIN"),
                false,
                group,
                List.of(group),
                List.of("offline.write")
        );
    }

    private OfflineScheduleResponse response(Long groupId) {
        return new OfflineScheduleResponse(
                groupId,
                "_flows/jack/test/flow.yaml",
                "schedule",
                "* * * * *",
                "Asia/Singapore",
                true,
                "hash",
                100L
        );
    }
}
