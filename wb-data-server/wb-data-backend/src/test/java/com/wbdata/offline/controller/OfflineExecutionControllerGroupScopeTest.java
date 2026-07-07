package com.wbdata.offline.controller;

import com.wbdata.auth.dto.AuthContextResponse;
import com.wbdata.auth.dto.CurrentUserResponse;
import com.wbdata.auth.dto.ProjectGroupContextItem;
import com.wbdata.offline.dto.DebugDocumentExecutionRequest;
import com.wbdata.offline.dto.DebugExecutionRequest;
import com.wbdata.offline.dto.OfflineExecutionResponse;
import com.wbdata.offline.dto.SaveOfflineFlowStageRequest;
import com.wbdata.offline.service.OfflineExecutionService;
import com.wbdata.offline.service.OfflineFlowContentService;
import com.wbdata.offline.service.OfflineFlowDocumentService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class OfflineExecutionControllerGroupScopeTest {

    @Test
    void debugExecutionUsesAuthenticatedGroupInsteadOfBodyGroup() {
        OfflineExecutionService executionService = mock(OfflineExecutionService.class);
        OfflineFlowContentService contentService = mock(OfflineFlowContentService.class);
        OfflineFlowDocumentService documentService = mock(OfflineFlowDocumentService.class);
        when(executionService.createDebugExecution(any(), eq(1L))).thenReturn(response());
        OfflineExecutionController controller = new OfflineExecutionController(executionService, contentService, documentService);

        controller.createDebugExecution(context(4L), new DebugExecutionRequest(
                999L,
                "_flows/jack/test/flow.yaml",
                """
                        id: test
                        namespace: pg-4
                        tasks: []
                        """,
                List.of(),
                "ALL"
        ));

        ArgumentCaptor<DebugExecutionRequest> captor = ArgumentCaptor.forClass(DebugExecutionRequest.class);
        verify(executionService).createDebugExecution(captor.capture(), eq(1L));
        assertThat(captor.getValue().groupId()).isEqualTo(4L);
    }

    @Test
    void documentDebugExecutionCompilesDraftWithAuthenticatedGroupInsteadOfBodyGroup() {
        OfflineExecutionService executionService = mock(OfflineExecutionService.class);
        OfflineFlowContentService contentService = mock(OfflineFlowContentService.class);
        OfflineFlowDocumentService documentService = mock(OfflineFlowDocumentService.class);
        when(documentService.compileFlowDraft(any())).thenReturn(new OfflineFlowDocumentService.CompiledFlowDraft(
                """
                        id: test
                        namespace: pg-4
                        tasks: []
                        """,
                Map.of()
        ));
        when(executionService.createDebugExecution(any(), any(), eq(1L))).thenReturn(response());
        OfflineExecutionController controller = new OfflineExecutionController(executionService, contentService, documentService);

        controller.createDebugExecutionFromDocument(context(4L), new DebugDocumentExecutionRequest(
                999L,
                "_flows/jack/test/flow.yaml",
                "hash",
                100L,
                List.of(new SaveOfflineFlowStageRequest("stage_1", List.of())),
                List.of(),
                Map.of(),
                List.of(),
                "ALL"
        ));

        ArgumentCaptor<DebugDocumentExecutionRequest> captor = ArgumentCaptor.forClass(DebugDocumentExecutionRequest.class);
        verify(documentService).compileFlowDraft(captor.capture());
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

    private OfflineExecutionResponse response() {
        return new OfflineExecutionResponse(
                "exec-1",
                "DEBUG",
                "_flows/jack/test/flow.yaml",
                "rev",
                "SUCCESS",
                Instant.parse("2026-07-06T00:00:00Z")
        );
    }
}
