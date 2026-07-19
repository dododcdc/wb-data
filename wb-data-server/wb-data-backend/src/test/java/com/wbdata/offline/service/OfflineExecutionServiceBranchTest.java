package com.wbdata.offline.service;

import com.wbdata.offline.config.OfflineKestraProperties;
import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.dto.DebugExecutionRequest;
import com.wbdata.offline.dto.OfflineRepoStatusResponse;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class OfflineExecutionServiceBranchTest {

    @Test
    void createDebugExecution_usesCurrentBranchNamespaceAndLabelsFlow() {
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        OfflineRepoStatusService repoStatusService = repoStatusService("feature/pipeline");
        OfflineExecutionService service = service(kestraClient, repoStatusService);
        when(kestraClient.createExecution(any(), any())).thenReturn(execution(
                "exec-1",
                "wb-debug-g1-bfeature-pipeline-6bc5fa26-u7",
                "example",
                "RUNNING",
                Map.of()
        ));

        service.createDebugExecution(request(), 7L);

        ArgumentCaptor<String> namespace = ArgumentCaptor.forClass(String.class);
        verify(kestraClient).createExecution(namespace.capture(), Mockito.eq("example"));
        assertThat(namespace.getValue()).matches("wb-debug-g1-bfeature-pipeline-[a-f0-9]{8}-u7");

        ArgumentCaptor<String> flowSource = ArgumentCaptor.forClass(String.class);
        verify(kestraClient).upsertFlow(flowSource.capture());
        assertThat(flowSource.getValue()).contains("wbdataBranch: feature/pipeline");
        assertThat(flowSource.getValue()).contains("wbdataDebugNamespace: " + namespace.getValue());
    }

    @Test
    void getExecution_readsBranchFromExecutionLabel() {
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        OfflineRepoStatusService repoStatusService = repoStatusService("main");
        OfflineExecutionService service = service(kestraClient, repoStatusService);
        when(kestraClient.getExecution("exec-1")).thenReturn(execution(
                "exec-1",
                "wb-debug-g1-bfeature-pipeline-6bc5fa26-u7",
                "example",
                "SUCCESS",
                Map.of(
                        "wbdataMode", "DEBUG",
                        "wbdataFlowPath", "_flows/example/flow.yaml",
                        "wbdataGroupId", "1",
                        "wbdataRequestedBy", "7",
                        "wbdataBranch", "feature/pipeline"
                )
        ));

        assertThat(service.getExecution(1L, "exec-1").branch()).isEqualTo("feature/pipeline");
    }

    @Test
    void listExecutions_filtersByCurrentBranchLabel() {
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        OfflineExecutionService service = service(kestraClient, repoStatusService("feature/pipeline"));
        when(kestraClient.searchExecutions(any())).thenReturn(List.of());

        service.listExecutions(1L, "_flows/example/flow.yaml", 7L);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, String>> filters = ArgumentCaptor.forClass(Map.class);
        verify(kestraClient).searchExecutions(filters.capture());
        assertThat(filters.getValue()).containsEntry("filters[labels][EQUALS][wbdataBranch]", "feature/pipeline");
        assertThat(filters.getValue().get("filters[namespace][EQUALS]"))
                .matches("wb-debug-g1-bfeature-pipeline-[a-f0-9]{8}-u7");
    }

    @Test
    void stopAllExecutions_onlyKillsCurrentBranchExecutions() {
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        OfflineExecutionService service = service(kestraClient, repoStatusService("feature/pipeline"));
        KestraExecutionSnapshot currentBranch = execution(
                "exec-current",
                "wb-debug-g1-bfeature-pipeline-6bc5fa26-u7",
                "example",
                "RUNNING",
                Map.of("wbdataBranch", "feature/pipeline")
        );
        KestraExecutionSnapshot otherBranch = execution(
                "exec-other",
                "wb-debug-g1-bmain-0d6e4079-u7",
                "example",
                "RUNNING",
                Map.of("wbdataBranch", "main")
        );
        when(kestraClient.searchExecutions(any())).thenReturn(List.of(currentBranch, otherBranch));

        int stopped = service.stopAllExecutions(1L, "_flows/example/flow.yaml");

        assertThat(stopped).isEqualTo(1);
        verify(kestraClient).killExecution("exec-current");
        verify(kestraClient, never()).killExecution("exec-other");
    }

    @Test
    void createDebugExecution_rejectsSelectedTransferWhenDockerTaskRunnerIsUnavailable() {
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        OfflineExecutionService service = service(kestraClient, repoStatusService("main"));
        when(kestraClient.supportsTaskType("io.kestra.plugin.scripts.runner.docker.Docker")).thenReturn(false);

        assertThatThrownBy(() -> service.createDebugExecution(transferRequest(), 7L))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(error -> ((ResponseStatusException) error).getStatusCode().value())
                .isEqualTo(400);

        verify(kestraClient).supportsTaskType("io.kestra.plugin.scripts.runner.docker.Docker");
        verify(kestraClient, never()).upsertFlow(any());
    }

    @Test
    void createDebugExecution_uploadsTransferSidecarAndAllowsSelectedTransfer() {
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        OfflineExecutionService service = service(kestraClient, repoStatusService("main"));
        when(kestraClient.supportsTaskType("io.kestra.plugin.scripts.runner.docker.Docker")).thenReturn(true);
        when(kestraClient.createExecution(any(), any())).thenReturn(execution(
                "exec-transfer",
                "wb-debug-g1-bmain-0d6e4079-u7",
                "example",
                "RUNNING",
                Map.of()
        ));

        service.createDebugExecution(
                transferRequest(),
                Map.of("transfers/example/transfer_orders.transfer.json", "{\"schemaVersion\":1}"),
                7L
        );

        verify(kestraClient).supportsTaskType("io.kestra.plugin.scripts.runner.docker.Docker");
        verify(kestraClient).upsertNamespaceFile(
                Mockito.matches("wb-debug-g1-bmain-[a-f0-9]{8}-u7"),
                Mockito.eq("/transfers/example/transfer_orders.transfer.json"),
                Mockito.eq("{\"schemaVersion\":1}")
        );
        ArgumentCaptor<String> flowSource = ArgumentCaptor.forClass(String.class);
        verify(kestraClient).upsertFlow(flowSource.capture());
        assertThat(flowSource.getValue()).doesNotContain("disabled: true");
    }

    private static OfflineExecutionService service(KestraClient kestraClient, OfflineRepoStatusService repoStatusService) {
        OfflineProperties offlineProperties = new OfflineProperties();
        OfflineKestraProperties kestraProperties = new OfflineKestraProperties();
        return new OfflineExecutionService(kestraClient, kestraProperties, offlineProperties, repoStatusService);
    }

    private static OfflineRepoStatusService repoStatusService(String branch) {
        OfflineRepoStatusService repoStatusService = Mockito.mock(OfflineRepoStatusService.class);
        when(repoStatusService.getRepoStatus(1L)).thenReturn(new OfflineRepoStatusResponse(
                1L,
                "/tmp/repo",
                true,
                true,
                false,
                false,
                true,
                true,
                branch,
                "abc123",
                "init",
                Instant.parse("2026-05-19T00:00:00Z")
        ));
        return repoStatusService;
    }

    private static DebugExecutionRequest request() {
        return new DebugExecutionRequest(
                1L,
                "_flows/example/flow.yaml",
                "id: example\nnamespace: pg-1\ntasks: []\n",
                List.of(),
                "ALL"
        );
    }

    private static DebugExecutionRequest transferRequest() {
        return new DebugExecutionRequest(
                1L,
                "_flows/example/flow.yaml",
                """
                        id: example
                        namespace: pg-1
                        tasks:
                          - id: transfer_orders
                            type: io.kestra.plugin.scripts.shell.Commands
                            description: "[wbdata-meta] nodeKind=TRANSFER;transferConfigPath=transfers/example/transfer_orders.transfer.json"
                            namespaceFiles:
                              enabled: true
                              include:
                                - transfers/example/transfer_orders.transfer.json
                            taskRunner:
                              type: io.kestra.plugin.scripts.runner.docker.Docker
                        """,
                List.of("transfer_orders"),
                "SELECTED"
        );
    }

    private static KestraExecutionSnapshot execution(String id,
                                                     String namespace,
                                                     String flowId,
                                                     String status,
                                                     Map<String, String> labels) {
        return new KestraExecutionSnapshot(
                id,
                namespace,
                flowId,
                status,
                null,
                Instant.parse("2026-05-19T00:00:00Z"),
                Instant.parse("2026-05-19T00:00:01Z"),
                null,
                List.of(),
                Map.of(),
                labels
        );
    }
}
