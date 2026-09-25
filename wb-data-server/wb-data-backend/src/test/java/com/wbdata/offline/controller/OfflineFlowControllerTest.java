package com.wbdata.offline.controller;

import com.wbdata.auth.context.GroupAuthContext;
import com.wbdata.auth.dto.ProjectGroupContextItem;
import com.wbdata.auth.service.AuthContextService;
import com.wbdata.auth.service.AuthSession;
import com.wbdata.offline.dto.FlowParameterBindingRequest;
import com.wbdata.offline.dto.SaveOfflineFlowDocumentRequest;
import com.wbdata.offline.service.OfflineFlowContentService;
import com.wbdata.offline.service.OfflineFlowDependencyService;
import com.wbdata.offline.service.OfflineFlowDocumentService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class OfflineFlowControllerTest {

    @Test
    void saveDocumentPreservesMultipleParameterBindingsWhileNormalizingGroup() {
        OfflineFlowContentService contentService = mock(OfflineFlowContentService.class);
        OfflineFlowDocumentService documentService = mock(OfflineFlowDocumentService.class);
        OfflineFlowDependencyService dependencyService = mock(OfflineFlowDependencyService.class);
        org.mockito.Mockito.when(dependencyService.saveDocument(org.mockito.ArgumentMatchers.any(),
                        org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any()))
                .thenAnswer(invocation -> invocation.<java.util.function.Supplier<?>>getArgument(2).get());
        AuthContextService authContextService = mock(AuthContextService.class);
        GroupAuthContext context = context(4L);
        List<ProjectGroupContextItem> accessibleGroups = List.of(
                new ProjectGroupContextItem(4L, "policy", "", "GROUP_ADMIN"));
        when(authContextService.listAccessibleGroups(context.user())).thenReturn(accessibleGroups);
        OfflineFlowController controller = new OfflineFlowController(contentService, documentService, dependencyService, authContextService);
        List<FlowParameterBindingRequest> bindings = List.of(
                new FlowParameterBindingRequest(101L, 1),
                new FlowParameterBindingRequest(102L, 2)
        );

        controller.saveFlowDocument(context, new SaveOfflineFlowDocumentRequest(
                999L, "_flows/example/flow.yaml", "hash", 1L,
                List.of(), List.of(), Map.of(), null, null, bindings, "Asia/Singapore",
                new com.wbdata.offline.dto.OfflineFlowDependencySettings(List.of(),
                        com.wbdata.offline.enums.OfflineFailurePolicy.PAUSE,
                        com.wbdata.offline.enums.OfflineCrossGroupDependency.DENY)
        ));

        ArgumentCaptor<SaveOfflineFlowDocumentRequest> captor =
                ArgumentCaptor.forClass(SaveOfflineFlowDocumentRequest.class);
        verify(documentService).saveFlowDocument(captor.capture());
        assertThat(captor.getValue().groupId()).isEqualTo(4L);
        assertThat(captor.getValue().parameterBindings()).isEqualTo(bindings);
        assertThat(captor.getValue().runtimeTimezone()).isEqualTo("Asia/Singapore");
        assertThat(captor.getValue().dependencyConfig().failurePolicy())
                .isEqualTo(com.wbdata.offline.enums.OfflineFailurePolicy.PAUSE);
        assertThat(captor.getValue().dependencyConfig().crossGroupDependency())
                .isEqualTo(com.wbdata.offline.enums.OfflineCrossGroupDependency.DENY);
        verify(dependencyService).saveDocument(org.mockito.ArgumentMatchers.eq(captor.getValue()),
                org.mockito.ArgumentMatchers.eq(accessibleGroups), org.mockito.ArgumentMatchers.any());
    }

    @Test
    void readingContentAndDocumentDoesNotLoadAccessibleGroups() {
        OfflineFlowContentService contentService = mock(OfflineFlowContentService.class);
        OfflineFlowDocumentService documentService = mock(OfflineFlowDocumentService.class);
        AuthContextService authContextService = mock(AuthContextService.class);
        OfflineFlowController controller = new OfflineFlowController(
                contentService, documentService, mock(OfflineFlowDependencyService.class), authContextService);
        GroupAuthContext context = context(4L);
        String path = "_flows/example/flow.yaml";

        controller.getFlowContent(context, path);
        controller.getFlowDocument(context, path);

        verify(contentService).getFlowContent(4L, path);
        verify(documentService).getFlowDocument(4L, path);
        verifyNoInteractions(authContextService);
    }

    @Test
    void deletionLoadsAccessibleGroupsForDependencyCheck() {
        OfflineFlowContentService contentService = mock(OfflineFlowContentService.class);
        OfflineFlowDependencyService dependencyService = mock(OfflineFlowDependencyService.class);
        when(dependencyService.withDependencyGraphLock(org.mockito.ArgumentMatchers.any()))
                .thenAnswer(invocation -> invocation.<java.util.function.Supplier<?>>getArgument(0).get());
        AuthContextService authContextService = mock(AuthContextService.class);
        GroupAuthContext context = context(4L);
        List<ProjectGroupContextItem> accessibleGroups = List.of(
                new ProjectGroupContextItem(4L, "policy", "", "GROUP_ADMIN"));
        when(authContextService.listAccessibleGroups(context.user())).thenReturn(accessibleGroups);
        OfflineFlowController controller = new OfflineFlowController(
                contentService, mock(OfflineFlowDocumentService.class), dependencyService, authContextService);
        String path = "_flows/example/flow.yaml";

        controller.deleteFlow(context, new com.wbdata.offline.dto.DeleteOfflineFlowRequest(999L, path));

        verify(dependencyService).assertDeletionAllowed(4L, path, accessibleGroups);
        verify(contentService).deleteFlow(4L, path);
    }

    private GroupAuthContext context(Long groupId) {
        return new GroupAuthContext(
                new AuthSession(1L, "admin", "admin", "ADMIN", Instant.now().plusSeconds(3600)),
                groupId,
                "policy"
        );
    }
}
