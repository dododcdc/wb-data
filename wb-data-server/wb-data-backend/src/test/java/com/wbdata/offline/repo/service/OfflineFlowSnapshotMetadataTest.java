package com.wbdata.offline.repo.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wbdata.datasource.service.DataSourceService;
import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.config.OfflineTransferProperties;
import com.wbdata.offline.dto.OfflineFlowDocumentResponse;
import com.wbdata.offline.dto.OfflineFlowNodeResponse;
import com.wbdata.offline.dto.OfflineFlowStageResponse;
import com.wbdata.offline.dto.OfflineFlowVersionSnapshotResponse;
import com.wbdata.offline.parameter.dto.FlowParameterBindingItemResponse;
import com.wbdata.offline.parameter.dto.FlowParameterBindingResponse;
import com.wbdata.offline.parameter.dto.FlowParameterDefinitionSnapshot;
import com.wbdata.offline.parameter.service.ExecutionParameterSnapshotRegistry;
import com.wbdata.offline.parameter.service.FlowParameterBindingAssembler;
import com.wbdata.offline.parameter.service.FlowParameterSnapshotStore;
import com.wbdata.offline.service.FlowGraphDraftBuilder;
import com.wbdata.offline.service.OfflineFlowContentService;
import com.wbdata.offline.service.OfflineFlowDocumentService;
import com.wbdata.offline.service.OfflineKestraFlowFileService;
import com.wbdata.offline.transfer.dto.TransferConfig;
import com.wbdata.offline.transfer.dto.TransferEndpointConfig;
import com.wbdata.offline.transfer.dto.TransferFieldMapping;
import com.wbdata.offline.transfer.dto.TransferMappingKind;
import com.wbdata.offline.transfer.dto.TransferWriteMode;
import com.wbdata.offline.transfer.service.TransferConfigFileService;
import com.wbdata.parameter.service.ParameterGroupService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class OfflineFlowSnapshotMetadataTest {

    @TempDir
    Path tempDir;

    @Test
    void extractsReferencedParametersAcrossSqlShellHiveTransferAndMalformedDrafts() {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        OfflineFlowDocumentService documentService = documentService(properties);

        FlowParameterBindingResponse binding = new FlowParameterBindingResponse(
                10L,
                "biz_core",
                "核心参数",
                2,
                2,
                "CURRENT",
                List.of(new FlowParameterDefinitionSnapshot(
                        "v_day", "SYSTEM_TIME", null, "yyyyMMdd", 0, null, 0, "PLANNED_TIME"
                )),
                List.of(new FlowParameterBindingItemResponse(
                        11L,
                        "ext_group",
                        "扩展参数",
                        1,
                        1,
                        "CURRENT",
                        List.of(new FlowParameterDefinitionSnapshot(
                                "hive_dt", "SYSTEM_TIME", null, "yyyy-MM-dd", 0, null, 1, "PLANNED_TIME"
                        ))
                ))
        );

        TransferConfig transferConfig = new TransferConfig(
                new TransferEndpointConfig(1L, "MYSQL", "src_db", "orders", "dt = ^[v_day]", null, null, null),
                new TransferEndpointConfig(2L, "MYSQL", "tgt_db", "dwd_orders", null, TransferWriteMode.APPEND,
                        List.of("DELETE FROM dwd_orders WHERE dt = ^[hive_dt]"), null),
                List.of(new TransferFieldMapping("id", TransferMappingKind.SOURCE_FIELD, "id", null)),
                List.of()
        );

        OfflineFlowDocumentResponse document = new OfflineFlowDocumentResponse(
                1L,
                "_flows/demo/flow.yaml",
                "demo",
                "policy.offline",
                "hash-1",
                1000L,
                List.of(new OfflineFlowStageResponse(
                        "stage_1",
                        false,
                        List.of(
                                new OfflineFlowNodeResponse("sql_node", "SQL", "scripts/demo/sql_node.sql",
                                        "SELECT * FROM orders WHERE dt = ^[v_day]", 1L, "MYSQL"),
                                new OfflineFlowNodeResponse("shell_node", "SHELL", "scripts/demo/shell_node.sh",
                                        "echo \"^[v_day]\"", null, null),
                                new OfflineFlowNodeResponse("hive_node", "HIVE_SQL", "scripts/demo/hive_node.sql",
                                        "SELECT * FROM logs WHERE dt = ^[hive_dt]", 3L, "HIVE"),
                                new OfflineFlowNodeResponse("transfer_node", "TRANSFER", null,
                                        null, null, null, transferConfig),
                                new OfflineFlowNodeResponse("broken_sql", "SQL", "scripts/demo/broken.sql",
                                        "SELECT '^[v_day]'", 1L, "MYSQL")
                        )
                )),
                List.of(),
                Map.of(),
                null,
                binding,
                "Asia/Shanghai",
                null
        );

        Map<String, List<String>> refs = documentService.extractReferencedParameters(document);

        assertThat(refs.get("sql_node")).containsExactly("v_day");
        assertThat(refs.get("shell_node")).containsExactly("v_day");
        assertThat(refs.get("hive_node")).containsExactly("hive_dt");
        assertThat(refs.get("transfer_node")).containsExactlyInAnyOrder("v_day", "hive_dt");
        assertThat(refs.get("broken_sql")).isEmpty();
    }

    @Test
    void getSnapshotPopulatesStructuredNodeMetadataFromRevisionFiles() throws Exception {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        Path repoPath = properties.resolveRepoPath(5L);
        Files.createDirectories(repoPath);

        OfflineFlowDocumentService documentService = documentService(properties);
        GitCommandService gitCommandService = mock(GitCommandService.class);
        String revision = "1234567890abcdef1234567890abcdef12345678";
        String flowYaml = """
                id: demo
                namespace: group5.offline
                tasks:
                  - id: shell_task
                    type: io.kestra.plugin.scripts.shell.Commands
                    namespaceFiles:
                      enabled: true
                      include:
                        - scripts/demo/shell_task.sh
                    commands:
                      - bash scripts/demo/shell_task.sh
                """;

        when(gitCommandService.readFileAtRevision(5L, revision, "_flows/demo/flow.yaml")).thenReturn(flowYaml);
        when(gitCommandService.readFileAtRevision(5L, revision, "scripts/demo/shell_task.sh"))
                .thenReturn("echo '^[v_day]'");
        when(gitCommandService.readFileAtRevision(5L, revision, "_flows/demo/.parameters.json"))
                .thenReturn("""
                        {"schemaVersion":2,"runtimeTimezone":"Asia/Shanghai","groupCode":"common","groupVersion":1,"definitions":[{"key":"v_day","valueSource":"CONSTANT","constantValue":"20261114","offsetDays":0,"sortOrder":0}]}
                        """);
        when(gitCommandService.readFileAtRevision(5L, revision, "_flows/demo/layout.json"))
                .thenThrow(new GitRepositoryOperations.GitException("missing"));
        when(gitCommandService.readFileAtRevision(5L, revision, "_kestra/demo.yaml"))
                .thenThrow(new GitRepositoryOperations.GitException("missing"));

        OfflineFlowSnapshotService snapshotService = new OfflineFlowSnapshotService(
                documentService,
                gitCommandService,
                properties
        );

        OfflineFlowVersionSnapshotResponse response = snapshotService.getSnapshot(5L, "_flows/demo/flow.yaml", revision);

        assertThat(response.nodeMetadata())
                .containsEntry("shell_task", new OfflineFlowVersionSnapshotResponse.NodeMetadata(List.of("v_day")));
    }

    private OfflineFlowDocumentService documentService(OfflineProperties properties) {
        RepoLockManager repoLockManager = new RepoLockManager();
        OfflineKestraFlowFileService kestraFlowFileService = new OfflineKestraFlowFileService(properties);
        ExecutionParameterSnapshotRegistry snapshotRegistry = mock(ExecutionParameterSnapshotRegistry.class);
        when(snapshotRegistry.register(anyLong(), any())).thenReturn("snapshot-1");
        FlowParameterSnapshotStore parameterSnapshotStore = new FlowParameterSnapshotStore(new ObjectMapper());
        TransferConfigFileService transferConfigFileService = new TransferConfigFileService(new ObjectMapper());
        return new OfflineFlowDocumentService(
                properties,
                new OfflineFlowContentService(properties, repoLockManager, kestraFlowFileService),
                repoLockManager,
                kestraFlowFileService,
                transferConfigFileService,
                parameterSnapshotStore,
                new FlowParameterBindingAssembler(mock(ParameterGroupService.class), parameterSnapshotStore),
                new FlowGraphDraftBuilder(mock(DataSourceService.class), transferConfigFileService),
                snapshotRegistry,
                new OfflineTransferProperties()
        );
    }
}
