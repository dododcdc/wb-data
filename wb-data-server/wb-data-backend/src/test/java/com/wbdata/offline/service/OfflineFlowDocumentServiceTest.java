package com.wbdata.offline.service;

import com.wbdata.datasource.service.DataSourceService;
import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.dto.NodePosition;
import com.wbdata.offline.dto.OfflineFlowSchedule;
import com.wbdata.offline.dto.SaveOfflineFlowDocumentRequest;
import com.wbdata.offline.dto.SaveOfflineFlowNodeRequest;
import com.wbdata.offline.dto.SaveOfflineFlowStageRequest;
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
                kestraFlowFileService
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
}
