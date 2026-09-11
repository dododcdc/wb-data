package com.wbdata.offline.controller;

import com.wbdata.auth.dto.AuthContextResponse;
import com.wbdata.auth.dto.CurrentUserResponse;
import com.wbdata.auth.dto.ProjectGroupContextItem;
import com.wbdata.offline.dto.FlowParameterBindingRequest;
import com.wbdata.offline.dto.SaveOfflineFlowDocumentRequest;
import com.wbdata.offline.service.OfflineFlowContentService;
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
        OfflineFlowController controller = new OfflineFlowController(contentService, documentService);
        List<FlowParameterBindingRequest> bindings = List.of(
                new FlowParameterBindingRequest(101L, 1),
                new FlowParameterBindingRequest(102L, 2)
        );

        controller.saveFlowDocument(context(4L), new SaveOfflineFlowDocumentRequest(
                999L, "_flows/example/flow.yaml", "hash", 1L,
                List.of(), List.of(), Map.of(), null, null, bindings, "Asia/Singapore"
        ));

        ArgumentCaptor<SaveOfflineFlowDocumentRequest> captor =
                ArgumentCaptor.forClass(SaveOfflineFlowDocumentRequest.class);
        verify(documentService).saveFlowDocument(captor.capture());
        assertThat(captor.getValue().groupId()).isEqualTo(4L);
        assertThat(captor.getValue().parameterBindings()).isEqualTo(bindings);
        assertThat(captor.getValue().runtimeTimezone()).isEqualTo("Asia/Singapore");
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
