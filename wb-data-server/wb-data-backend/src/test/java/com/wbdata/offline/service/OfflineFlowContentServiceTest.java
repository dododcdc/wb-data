package com.wbdata.offline.service;

import com.wbdata.offline.config.OfflineProperties;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.TreeMap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assertions.assertAll;

class OfflineFlowContentServiceTest {
    @TempDir
    Path tempDir;

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {" ", ".", "..", "../escaped", "../../escaped", "..\\escaped",
            "folder/name", "folder\\name", "renamed/", "./renamed", "folder/../renamed", "C:\\escaped"})
    void renameRejectsNonDirectoryNamesBeforeMovingAnyFiles(String newName) throws Exception {
        assertRenameRejectedWithoutChanges(newName);
    }

    @Test
    void renameRejectsAbsoluteDestinationBeforeMovingAnyFiles() throws Exception {
        assertRenameRejectedWithoutChanges(tempDir.resolve("escaped").toString());
    }

    private void assertRenameRejectedWithoutChanges(String newName) throws Exception {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        OfflineFlowContentService service = new OfflineFlowContentService(
                properties, new RepoLockManager(), new OfflineKestraFlowFileService(properties));
        Path repo = properties.resolveRepoPath(1L);
        Path flowDir = repo.resolve("_flows/example");
        Path scriptsDir = repo.resolve("scripts/example");
        Files.createDirectories(flowDir);
        Files.createDirectories(scriptsDir);
        Files.writeString(flowDir.resolve("flow.yaml"), "id: example\ntasks: []\n");
        Files.writeString(flowDir.resolve(".parameters.json"), "{\"schemaVersion\":1}\n");
        Files.writeString(scriptsDir.resolve("node.sh"), "echo 1\n");
        Files.writeString(tempDir.resolve("unrelated.txt"), "unrelated");
        Map<String, String> before = files();

        assertAll(
                () -> assertThatThrownBy(() -> service.renameFlow(1L, "_flows/example/flow.yaml", newName))
                        .isInstanceOf(IllegalArgumentException.class),
                () -> assertThat(files()).isEqualTo(before)
        );
    }

    @ParameterizedTest
    @ValueSource(strings = {"中文任务", "task with spaces", " 中文 任务 ", "literal$1.name"})
    void renamePreservesChineseNamesAndSpaces(String newName) throws Exception {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        OfflineFlowContentService service = new OfflineFlowContentService(
                properties, new RepoLockManager(), new OfflineKestraFlowFileService(properties));
        Path repo = properties.resolveRepoPath(1L);
        Path flowDir = repo.resolve("_flows/example");
        Path scriptsDir = repo.resolve("scripts/example");
        Files.createDirectories(flowDir);
        Files.createDirectories(scriptsDir);
        Files.writeString(flowDir.resolve("flow.yaml"), "script: scripts/example/node.sh\n");
        Files.writeString(scriptsDir.resolve("node.sh"), "echo 1\n");

        service.renameFlow(1L, "_flows/example/flow.yaml", newName);

        assertThat(flowDir).doesNotExist();
        assertThat(scriptsDir).doesNotExist();
        assertThat(Files.readString(repo.resolve("_flows").resolve(newName).resolve("flow.yaml")))
                .isEqualTo("script: scripts/" + newName + "/node.sh\n");
        assertThat(Files.readString(repo.resolve("scripts").resolve(newName).resolve("node.sh")))
                .isEqualTo("echo 1\n");
    }

    private Map<String, String> files() throws IOException {
        Map<String, String> result = new TreeMap<>();
        try (var paths = Files.walk(tempDir)) {
            for (Path path : paths.filter(Files::isRegularFile).toList()) {
                result.put(tempDir.relativize(path).toString(),
                        Files.getLastModifiedTime(path) + "\n" + Files.readString(path));
            }
        }
        return result;
    }

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
