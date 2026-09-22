package com.wbdata.offline.controller;

import com.wbdata.auth.dto.AuthContextResponse;
import com.wbdata.auth.dto.CurrentUserResponse;
import com.wbdata.auth.dto.ProjectGroupContextItem;
import com.wbdata.offline.dto.OfflineDependencyConfigResponse;
import com.wbdata.offline.dto.OfflineFlowDependencyRef;
import com.wbdata.offline.dto.UpdateOfflineDependenciesRequest;
import com.wbdata.offline.enums.OfflineCrossGroupDependency;
import com.wbdata.offline.enums.OfflineFailurePolicy;
import com.wbdata.offline.service.OfflineFlowDependencyService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class OfflineDependencyControllerGroupScopeTest {

    @Test
    void updateDependenciesUsesAuthenticatedGroupAndAccessibleGroups() {
        OfflineFlowDependencyService service = mock(OfflineFlowDependencyService.class);
        when(service.updateConfig(any(), anyList())).thenReturn(new OfflineDependencyConfigResponse(
                4L, "_flows/jack/test/flow.yaml", List.of(),
                OfflineFailurePolicy.CONTINUE, OfflineCrossGroupDependency.ALLOW, "hash", 100L));
        OfflineDependencyController controller = new OfflineDependencyController(service);
        AuthContextResponse context = context(4L, 9L);

        controller.updateDependencies(context, new UpdateOfflineDependenciesRequest(
                999L,
                "_flows/jack/test/flow.yaml",
                List.of(new OfflineFlowDependencyRef(9L, "ods_user")),
                OfflineFailurePolicy.CONTINUE,
                OfflineCrossGroupDependency.ALLOW,
                "hash",
                100L
        ));

        ArgumentCaptor<UpdateOfflineDependenciesRequest> requestCaptor =
                ArgumentCaptor.forClass(UpdateOfflineDependenciesRequest.class);
        ArgumentCaptor<List<ProjectGroupContextItem>> groupsCaptor =
                ArgumentCaptor.forClass(List.class);
        verify(service).updateConfig(requestCaptor.capture(), groupsCaptor.capture());
        assertThat(requestCaptor.getValue().groupId()).isEqualTo(4L);
        assertThat(groupsCaptor.getValue()).extracting(ProjectGroupContextItem::id)
                .containsExactly(4L, 9L);
    }

    private AuthContextResponse context(Long currentGroupId, Long otherGroupId) {
        ProjectGroupContextItem current = new ProjectGroupContextItem(currentGroupId, "policy", "", "GROUP_ADMIN");
        ProjectGroupContextItem other = new ProjectGroupContextItem(otherGroupId, "ingest", "", "DEVELOPER");
        return new AuthContextResponse(
                new CurrentUserResponse(1L, "admin", "admin", "ADMIN"),
                false,
                current,
                List.of(current, other),
                List.of("offline.write")
        );
    }
}
