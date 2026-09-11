package com.wbdata.offline.service;

import com.wbdata.offline.config.OfflineProperties;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

class OfflineFlowContentServiceTest {
    @TempDir
    Path tempDir;

    @Test
    void renameAndDeleteFlowCarryParameterSnapshotWithFlowDirectory() throws Exception {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        RepoLockManager lockManager = new RepoLockManager();
        OfflineFlowContentService service = new OfflineFlowContentService(
                properties,
                lockManager,
                new OfflineKestraFlowFileService(properties)
        );
        Path repo = properties.resolveRepoPath(1L);
        Path flowDir = repo.resolve("_flows/example");
        Files.createDirectories(flowDir);
        Files.writeString(flowDir.resolve("flow.yaml"), "id: example\ntasks: []\n");
        Files.writeString(flowDir.resolve(".parameters.json"), "{\"schemaVersion\":1}\n");

        service.renameFlow(1L, "_flows/example/flow.yaml", "renamed");

        assertThat(repo.resolve("_flows/example/.parameters.json")).doesNotExist();
        assertThat(repo.resolve("_flows/renamed/.parameters.json")).isRegularFile();

        service.deleteFlow(1L, "_flows/renamed/flow.yaml");

        assertThat(repo.resolve("_flows/renamed")).doesNotExist();
    }

    @Test
    void deleteFlowRemovesPublishedKestraMirror() throws Exception {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        RepoLockManager lockManager = new RepoLockManager();
        OfflineKestraFlowFileService kestraFlowFileService = new OfflineKestraFlowFileService(properties);
        OfflineFlowContentService service = new OfflineFlowContentService(
                properties,
                lockManager,
                kestraFlowFileService
        );
        Path repo = properties.resolveRepoPath(1L);
        Path flow = repo.resolve("_flows/example/flow.yaml");
        Files.createDirectories(flow.getParent());
        Files.writeString(flow, "id: example\ntasks: []\n");
        kestraFlowFileService.syncFlowFile(repo, "_flows/example/flow.yaml");

        service.deleteFlow(1L, "_flows/example/flow.yaml");

        assertThat(kestraFlowFileService.resolveFlowFile(repo, "_flows/example/flow.yaml"))
                .doesNotExist();
    }
}
