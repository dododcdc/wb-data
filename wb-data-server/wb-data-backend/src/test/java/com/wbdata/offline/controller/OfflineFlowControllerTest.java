package com.wbdata.offline.controller;

import com.wbdata.auth.dto.AuthContextResponse;
import com.wbdata.auth.dto.CurrentUserResponse;
import com.wbdata.auth.dto.ProjectGroupContextItem;
import com.wbdata.offline.dto.FlowParameterBindingRequest;
import com.wbdata.offline.dto.SaveOfflineFlowDocumentRequest;
import com.wbdata.offline.service.OfflineFlowContentService;
import com.wbdata.offline.service.OfflineFlowDependencyService;
import com.wbdata.offline.service.OfflineFlowDocumentService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class OfflineFlowControllerTest {

    @Test
    void saveDocumentPreservesMultipleParameterBindingsWhileNormalizingGroup() {
        OfflineFlowContentService contentService = mock(OfflineFlowContentService.class);
        OfflineFlowDocumentService documentService = mock(OfflineFlowDocumentService.class);
        OfflineFlowDependencyService dependencyService = mock(OfflineFlowDependencyService.class);
        org.mockito.Mockito.when(dependencyService.saveDocument(org.mockito.ArgumentMatchers.any(),
                        org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any()))
                .thenAnswer(invocation -> invocation.<java.util.function.Supplier<?>>getArgument(2).get());
        OfflineFlowController controller = new OfflineFlowController(contentService, documentService, dependencyService);
        List<FlowParameterBindingRequest> bindings = List.of(
                new FlowParameterBindingRequest(101L, 1),
                new FlowParameterBindingRequest(102L, 2)
        );

        controller.saveFlowDocument(context(4L), new SaveOfflineFlowDocumentRequest(
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
                org.mockito.ArgumentMatchers.eq(context(4L).accessibleGroups()), org.mockito.ArgumentMatchers.any());
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
}
