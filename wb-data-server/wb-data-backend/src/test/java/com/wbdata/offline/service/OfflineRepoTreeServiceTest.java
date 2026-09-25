package com.wbdata.offline.service;

import com.wbdata.offline.config.OfflineProperties;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class OfflineRepoTreeServiceTest {
    @TempDir
    Path tempDir;

    private OfflineRepoTreeService service() {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        return new OfflineRepoTreeService(properties, new RepoLockManager());
    }

    private Path repo() {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        return properties.resolveRepoPath(1L);
    }

    @Test
    void moveFolderAcrossDirectoriesMovesScriptsMirrorAndRewritesReferences() throws Exception {
        Path repo = repo();
        Files.createDirectories(repo.resolve("_flows/x/nested/task-a"));
        Files.writeString(repo.resolve("_flows/x/nested/task-a/flow.yaml"),
                "script: scripts/x/nested/task-a/node.sh\n");
        Files.createDirectories(repo.resolve("scripts/x/nested/task-a"));
        Files.writeString(repo.resolve("scripts/x/nested/task-a/node.sh"), "echo 1\n");

        service().moveFolder(1L, "_flows/x/nested", "_flows/y/moved");

        assertThat(repo.resolve("_flows/x/nested")).doesNotExist();
        assertThat(repo.resolve("scripts/x/nested")).doesNotExist();
        assertThat(Files.readString(repo.resolve("_flows/y/moved/task-a/flow.yaml")))
                .isEqualTo("script: scripts/y/moved/task-a/node.sh\n");
        assertThat(Files.readString(repo.resolve("scripts/y/moved/task-a/node.sh")))
                .isEqualTo("echo 1\n");
    }

    @Test
    void renameAsSameDirectoryMoveStillWorks() throws Exception {
        Path repo = repo();
        Files.createDirectories(repo.resolve("_flows/jack/task-a"));
        Files.writeString(repo.resolve("_flows/jack/task-a/flow.yaml"),
                "script: scripts/jack/task-a/node.sh\n");
        Files.createDirectories(repo.resolve("scripts/jack/task-a"));
        Files.writeString(repo.resolve("scripts/jack/task-a/node.sh"), "echo 1\n");

        service().moveFolder(1L, "_flows/jack", "_flows/jack-renamed");

        assertThat(repo.resolve("_flows/jack")).doesNotExist();
        assertThat(Files.readString(repo.resolve("_flows/jack-renamed/task-a/flow.yaml")))
                .isEqualTo("script: scripts/jack-renamed/task-a/node.sh\n");
        assertThat(repo.resolve("scripts/jack-renamed/task-a/node.sh")).isRegularFile();
    }

    @Test
    void moveFolderRejectsMovingIntoOwnSubtree() throws Exception {
        Path repo = repo();
        Files.createDirectories(repo.resolve("_flows/x/sub"));

        assertThatThrownBy(() -> service().moveFolder(1L, "_flows/x", "_flows/x/sub/deeper"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("自身子目录");
        assertThat(repo.resolve("_flows/x/sub")).isDirectory();
    }

    @Test
    void moveFolderRejectsExistingDestination() throws Exception {
        Path repo = repo();
        Files.createDirectories(repo.resolve("_flows/x"));
        Files.createDirectories(repo.resolve("_flows/y/x"));

        assertThatThrownBy(() -> service().moveFolder(1L, "_flows/x", "_flows/y/x"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("已存在");
        assertThat(repo.resolve("_flows/x")).isDirectory();
    }

    @ParameterizedTest
    @ValueSource(strings = {"_flows", "scripts/x", "../outside", "_flows/bad\\name"})
    void moveFolderRejectsIllegalDestination(String newPath) throws Exception {
        Path repo = repo();
        Files.createDirectories(repo.resolve("_flows/x"));

        assertThatThrownBy(() -> service().moveFolder(1L, "_flows/x", newPath))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(repo.resolve("_flows/x")).isDirectory();
    }

    @Test
    void moveFolderRejectsSourceOutsideFlows() throws Exception {
        Path repo = repo();
        Files.createDirectories(repo.resolve("scripts/x"));

        assertThatThrownBy(() -> service().moveFolder(1L, "scripts/x", "_flows/x"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("_flows");
        assertThat(repo.resolve("scripts/x")).isDirectory();
    }
}
