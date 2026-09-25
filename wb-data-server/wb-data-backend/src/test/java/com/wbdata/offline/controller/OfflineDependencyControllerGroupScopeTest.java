package com.wbdata.offline.controller;

import com.wbdata.auth.context.GroupAuthContext;
import com.wbdata.auth.dto.ProjectGroupContextItem;
import com.wbdata.auth.service.AuthContextService;
import com.wbdata.auth.service.AuthSession;
import com.wbdata.offline.dto.OfflineDependencyConfigResponse;
import com.wbdata.offline.dto.OfflineFlowDependencyRef;
import com.wbdata.offline.dto.UpdateOfflineDependenciesRequest;
import com.wbdata.offline.enums.OfflineCrossGroupDependency;
import com.wbdata.offline.enums.OfflineFailurePolicy;
import com.wbdata.offline.service.OfflineFlowDependencyService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Instant;
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
        AuthContextService authContextService = mock(AuthContextService.class);
        GroupAuthContext context = context(4L);
        List<ProjectGroupContextItem> accessibleGroups = List.of(
                new ProjectGroupContextItem(4L, "policy", "", "GROUP_ADMIN"),
                new ProjectGroupContextItem(9L, "ingest", "", "DEVELOPER"));
        when(authContextService.listAccessibleGroups(context.user())).thenReturn(accessibleGroups);
        OfflineDependencyController controller = new OfflineDependencyController(service, authContextService);

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
        assertThat(groupsCaptor.getValue()).isEqualTo(accessibleGroups);
        assertThat(groupsCaptor.getValue()).extracting(ProjectGroupContextItem::id)
                .containsExactly(4L, 9L);
    }

    @Test
    void dependencyReadsUseAuthenticatedGroupAndExplicitlyLoadedAccessibleGroups() {
        OfflineFlowDependencyService service = mock(OfflineFlowDependencyService.class);
        AuthContextService authContextService = mock(AuthContextService.class);
        GroupAuthContext context = context(4L);
        List<ProjectGroupContextItem> accessibleGroups = List.of(
                new ProjectGroupContextItem(4L, "policy", "", "GROUP_ADMIN"),
                new ProjectGroupContextItem(9L, "ingest", "", "DEVELOPER"));
        when(authContextService.listAccessibleGroups(context.user())).thenReturn(accessibleGroups);
        OfflineDependencyController controller = new OfflineDependencyController(service, authContextService);
        String path = "_flows/jack/test/flow.yaml";

        controller.getDependencies(context, path);
        controller.searchCandidates(context, path, "ods");
        controller.findDependents(context, path);

        verify(service).getConfig(4L, path, accessibleGroups);
        verify(service).searchCandidates(4L, path, "ods", accessibleGroups);
        verify(service).findDependents(4L, path, accessibleGroups);
    }

    private GroupAuthContext context(Long groupId) {
        return new GroupAuthContext(
                new AuthSession(1L, "admin", "admin", "ADMIN", Instant.now().plusSeconds(3600)),
                groupId,
                "policy"
        );
    }
}
