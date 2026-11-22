package com.wbdata.offline.repo.service;

import com.wbdata.group.service.GroupCreatedEvent;
import com.wbdata.offline.config.OfflineProperties;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

class OfflineGroupRepoInitializerTest {

    @TempDir
    Path tempDir;

    @Test
    void onGroupCreatedInitializesLocalGitRepoAndPlaceholderDirectories() throws Exception {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        OfflineGroupRepoInitializer initializer = new OfflineGroupRepoInitializer(properties, new RepoLockManager());

        initializer.onGroupCreated(new GroupCreatedEvent(7L));

        Path repoPath = properties.resolveRepoPath(7L);
        assertThat(repoPath.resolve("_flows/.gitkeep")).isRegularFile();
        assertThat(repoPath.resolve("scripts/.gitkeep")).isRegularFile();
        assertThat(repoPath.resolve(".git")).isDirectory();

        Process process = new ProcessBuilder("git", "-C", repoPath.toString(), "symbolic-ref", "--short", "HEAD")
                .redirectErrorStream(true)
                .start();
        String branch = new String(process.getInputStream().readAllBytes()).trim();
        assertThat(process.waitFor()).isZero();
        assertThat(branch).isEqualTo("main");
    }
}
