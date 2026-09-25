package com.wbdata.offline.controller;

import com.wbdata.auth.context.GroupAuthContext;
import com.wbdata.auth.dto.ProjectGroupContextItem;
import com.wbdata.auth.service.AuthContextService;
import com.wbdata.auth.service.AuthSession;
import com.wbdata.offline.dto.OfflineScheduleResponse;
import com.wbdata.offline.dto.UpdateOfflineScheduleRequest;
import com.wbdata.offline.dto.UpdateOfflineScheduleStatusRequest;
import com.wbdata.offline.enums.OfflineSchedulePeriod;
import com.wbdata.offline.service.OfflineFlowDependencyService;
import com.wbdata.offline.service.OfflineScheduleService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class OfflineScheduleControllerGroupScopeTest {

    @Test
    void updateScheduleUsesAuthenticatedGroupInsteadOfBodyGroup() {
        OfflineScheduleService service = mock(OfflineScheduleService.class);
        when(service.updateSchedule(any())).thenReturn(response(4L));
        OfflineFlowDependencyService dependencies = mock(OfflineFlowDependencyService.class);
        when(dependencies.withDependencyGraphLock(any()))
                .thenAnswer(invocation -> invocation.<java.util.function.Supplier<?>>getArgument(0).get());
        AuthContextService authContextService = mock(AuthContextService.class);
        GroupAuthContext context = context(4L);
        List<ProjectGroupContextItem> accessibleGroups = List.of(
                new ProjectGroupContextItem(4L, "policy", "", "GROUP_ADMIN"));
        when(authContextService.listAccessibleGroups(context.user())).thenReturn(accessibleGroups);
        OfflineScheduleController controller = new OfflineScheduleController(service, dependencies, authContextService);

        controller.updateSchedule(context, new UpdateOfflineScheduleRequest(
                999L,
                "_flows/jack/test/flow.yaml",
                "* * * * *",
                OfflineSchedulePeriod.CUSTOM,
                "hash",
                100L
        ));

        ArgumentCaptor<UpdateOfflineScheduleRequest> captor = ArgumentCaptor.forClass(UpdateOfflineScheduleRequest.class);
        verify(service).updateSchedule(captor.capture());
        assertThat(captor.getValue().groupId()).isEqualTo(4L);
        verify(dependencies).assertPeriodChangeAllowed(
                4L, "_flows/jack/test/flow.yaml", OfflineSchedulePeriod.CUSTOM, accessibleGroups);
    }

    @Test
    void updateScheduleStatusUsesAuthenticatedGroupInsteadOfBodyGroup() {
        OfflineScheduleService service = mock(OfflineScheduleService.class);
        when(service.updateScheduleStatus(any())).thenReturn(response(4L));
        AuthContextService authContextService = mock(AuthContextService.class);
        OfflineScheduleController controller = new OfflineScheduleController(
                service, mock(OfflineFlowDependencyService.class), authContextService);

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
        verifyNoInteractions(authContextService);
    }

    @Test
    void readingScheduleDoesNotLoadAccessibleGroups() {
        OfflineScheduleService service = mock(OfflineScheduleService.class);
        AuthContextService authContextService = mock(AuthContextService.class);
        OfflineScheduleController controller = new OfflineScheduleController(
                service, mock(OfflineFlowDependencyService.class), authContextService);
        String path = "_flows/jack/test/flow.yaml";

        controller.getSchedule(context(4L), path);

        verify(service).getSchedule(4L, path);
        verifyNoInteractions(authContextService);
    }

    private GroupAuthContext context(Long groupId) {
        return new GroupAuthContext(
                new AuthSession(1L, "admin", "admin", "ADMIN", Instant.now().plusSeconds(3600)),
                groupId,
                "policy"
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
                OfflineSchedulePeriod.CUSTOM,
                "hash",
                100L
        );
    }
}
