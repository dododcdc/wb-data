package com.wbdata.offline.service;

import com.wbdata.datasource.service.DataSourceService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.config.OfflineTransferProperties;
import com.wbdata.offline.dto.NodePosition;
import com.wbdata.offline.dto.OfflineFlowSchedule;
import com.wbdata.offline.dto.SaveOfflineFlowDocumentRequest;
import com.wbdata.offline.dto.SaveOfflineFlowNodeRequest;
import com.wbdata.offline.dto.SaveOfflineFlowStageRequest;
import com.wbdata.offline.transfer.dto.TransferConfig;
import com.wbdata.offline.transfer.dto.TransferEndpointConfig;
import com.wbdata.offline.transfer.dto.TransferFieldMapping;
import com.wbdata.offline.transfer.dto.TransferMappingKind;
import com.wbdata.offline.transfer.dto.TransferWriteMode;
import com.wbdata.offline.transfer.service.TransferConfigFileService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class OfflineFlowDocumentServiceTest {

    @TempDir
    Path tempDir;

    @Test
    void saveFlowDocument_persistsScheduleToFlowYamlAndKestraSyncFile() throws Exception {
        OfflineProperties properties = offlineProperties();
        RepoLockManager repoLockManager = new RepoLockManager();
        OfflineFlowDocumentService service = service(properties, repoLockManager);

        var response = service.saveFlowDocument(saveRequest(new OfflineFlowSchedule(
                "* * * * *",
                "Asia/Singapore",
                true
        )));

        assertThat(response.schedule())
                .usingRecursiveComparison()
                .isEqualTo(new OfflineFlowSchedule("* * * * *", "Asia/Singapore", true));

        Path repoPath = properties.resolveRepoPath(1L);
        String flowYaml = Files.readString(repoPath.resolve("_flows/example/flow.yaml"));
        assertThat(flowYaml)
                .contains("triggers:")
                .contains("type: io.kestra.plugin.core.trigger.Schedule")
                .contains("cron:")
                .contains("* * * * *")
                .contains("timezone: Asia/Singapore")
                .contains("recoverMissedSchedules: NONE")
                .doesNotContain("disabled: true");

        Path kestraFlowFile = repoPath.resolve(".wb-data/kestra-flows/example.yaml");
        assertThat(Files.readString(kestraFlowFile)).isEqualTo(flowYaml);
    }

    @Test
    void resolveManagedFiles_includesYamlLayoutScriptsAndKestraFlow() {
        OfflineProperties properties = offlineProperties();
        RepoLockManager repoLockManager = new RepoLockManager();
        OfflineFlowDocumentService service = service(properties, repoLockManager);

        service.saveFlowDocument(saveRequest(null));

        assertThat(service.resolveManagedFiles(1L, "_flows/example/flow.yaml"))
                .containsExactlyInAnyOrder(
                        "_flows/example/flow.yaml",
                        "_flows/example/.layout.json",
                        ".wb-data/kestra-flows/example.yaml",
                        "scripts/example/node_1.sh"
                );
    }

    @Test
    void saveFlowDocument_persistsAndReopensScriptlessTransferAlongsideScriptNode() throws Exception {
        OfflineProperties properties = offlineProperties();
        RepoLockManager repoLockManager = new RepoLockManager();
        OfflineFlowDocumentService service = service(properties, repoLockManager);
        TransferConfig transfer = validTransfer();

        service.saveFlowDocument(new SaveOfflineFlowDocumentRequest(
                1L,
                "_flows/example/flow.yaml",
                null,
                0L,
                List.of(new SaveOfflineFlowStageRequest(
                        "main",
                        List.of(
                                new SaveOfflineFlowNodeRequest(
                                        "node_1",
                                        "echo 1",
                                        "SHELL",
                                        "scripts/example/node_1.sh",
                                        null,
                                        null
                                ),
                                new SaveOfflineFlowNodeRequest(
                                        "1transfer_orders",
                                        null,
                                        "TRANSFER",
                                        null,
                                        null,
                                        null,
                                        transfer
                                )
                        )
                )),
                List.of(),
                Map.of(),
                null
        ));

        var reopened = service.getFlowDocument(1L, "_flows/example/flow.yaml");
        var scriptNode = reopened.stages().getFirst().nodes().getFirst();
        var transferNode = reopened.stages().getFirst().nodes().get(1);

        assertThat(scriptNode.scriptPath()).isEqualTo("scripts/example/node_1.sh");
        assertThat(scriptNode.scriptContent()).isEqualTo("echo 1");
        assertThat(scriptNode.transfer()).isNull();
        assertThat(transferNode.taskId()).isEqualTo("1transfer_orders");
        assertThat(transferNode.kind()).isEqualTo("TRANSFER");
        assertThat(transferNode.scriptPath()).isNull();
        assertThat(transferNode.scriptContent()).isNull();
        assertThat(transferNode.transfer()).usingRecursiveComparison().isEqualTo(transfer);

        Path repoPath = properties.resolveRepoPath(1L);
        assertThat(Files.readString(repoPath.resolve("scripts/example/node_1.sh"))).isEqualTo("echo 1");
        assertThat(repoPath.resolve("transfers/example/1transfer_orders.transfer.json")).isRegularFile();
        assertThat(service.resolveManagedFiles(1L, "_flows/example/flow.yaml"))
                .contains("scripts/example/node_1.sh", "transfers/example/1transfer_orders.transfer.json");
    }

    @Test
    void saveFlowDocument_deletesTransferSidecarForRemovedTransferNode() {
        OfflineProperties properties = offlineProperties();
        RepoLockManager repoLockManager = new RepoLockManager();
        OfflineFlowDocumentService service = service(properties, repoLockManager);

        service.saveFlowDocument(transferOnlyRequest("transfer_1"));
        service.saveFlowDocument(scriptOnlyRequest());

        assertThat(properties.resolveRepoPath(1L)
                .resolve("transfers/example/transfer_1.transfer.json")).doesNotExist();
    }

    private OfflineProperties offlineProperties() {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        return properties;
    }

    private OfflineFlowDocumentService service(OfflineProperties properties, RepoLockManager repoLockManager) {
        OfflineKestraFlowFileService kestraFlowFileService = new OfflineKestraFlowFileService(properties);
        return new OfflineFlowDocumentService(
                properties,
                new OfflineFlowContentService(properties, repoLockManager, kestraFlowFileService),
                mock(DataSourceService.class),
                repoLockManager,
                kestraFlowFileService,
                new TransferConfigFileService(new ObjectMapper()),
                new OfflineTransferProperties()
        );
    }

    private SaveOfflineFlowDocumentRequest saveRequest(OfflineFlowSchedule schedule) {
        return new SaveOfflineFlowDocumentRequest(
                1L,
                "_flows/example/flow.yaml",
                null,
                0L,
                List.of(new SaveOfflineFlowStageRequest(
                        "main",
                        List.of(new SaveOfflineFlowNodeRequest(
                                "node_1",
                                "echo 1",
                                "SHELL",
                                "scripts/example/node_1.sh",
                                null,
                                null
                        ))
                )),
                List.of(),
                Map.of("node_1", new NodePosition(10, 20)),
                schedule
        );
    }

    private SaveOfflineFlowDocumentRequest transferOnlyRequest(String taskId) {
        return new SaveOfflineFlowDocumentRequest(
                1L, "_flows/example/flow.yaml", null, 0L,
                List.of(new SaveOfflineFlowStageRequest("main", List.of(new SaveOfflineFlowNodeRequest(
                        taskId, null, "TRANSFER", null, null, null, validTransfer()
                )))),
                List.of(), Map.of(), null
        );
    }

    private SaveOfflineFlowDocumentRequest scriptOnlyRequest() {
        return new SaveOfflineFlowDocumentRequest(
                1L, "_flows/example/flow.yaml", null, 0L,
                List.of(new SaveOfflineFlowStageRequest("main", List.of(new SaveOfflineFlowNodeRequest(
                        "node_1", "echo 1", "SHELL", "scripts/example/node_1.sh", null, null
                )))),
                List.of(), Map.of(), null
        );
    }

    private TransferConfig validTransfer() {
        return new TransferConfig(
                new TransferEndpointConfig(1L, "MYSQL", "source_db", "orders", "id > 0", null),
                new TransferEndpointConfig(2L, "HIVE", "target_db", "dwd_orders", null,
                        TransferWriteMode.APPEND),
                List.of(new TransferFieldMapping(
                        "order_id",
                        TransferMappingKind.SOURCE_FIELD,
                        "id",
                        null
                )),
                List.of()
        );
    }
}
