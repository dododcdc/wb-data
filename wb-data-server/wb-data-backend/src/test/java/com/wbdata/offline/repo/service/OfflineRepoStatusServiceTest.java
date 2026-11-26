package com.wbdata.offline.repo.service;

import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.repo.dto.OfflineRepoStatusResponse;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class OfflineRepoStatusServiceTest {

    @TempDir
    Path tempDir;

    @Test
    void reportsUpstreamAheadDirtyAndChineseCommitMessageWhenTrackingRemote() throws Exception {
        OfflineProperties properties = properties();
        Path repo = properties.resolveRepoPath(1L);
        Path remote = tempDir.resolve("remote.git");
        git(tempDir, "init", "--bare", remote.toString());
        initRepo(repo);
        write(repo, "_flows/example/flow.yaml", "id: example\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "init");
        git(repo, "remote", "add", "origin", remote.toString());
        git(repo, "push", "-u", "origin", "HEAD");

        write(repo, "_flows/example/flow.yaml", "id: example\n# v2\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "feat: 中文提交信息");
        write(repo, "_flows/untracked/flow.yaml", "id: untracked\n");

        OfflineRepoStatusService service = new OfflineRepoStatusService(properties);
        OfflineRepoStatusResponse status = service.getRepoStatus(1L);

        assertThat(status.exists()).isTrue();
        assertThat(status.gitInitialized()).isTrue();
        assertThat(status.hasUpstream()).isTrue();
        assertThat(status.hasRemote()).isTrue();
        assertThat(status.ahead()).isTrue();
        assertThat(status.dirty()).isTrue();
        assertThat(status.branch()).isEqualTo("main");
        assertThat(status.headCommitId()).isNotBlank();
        assertThat(status.headCommitMessage()).isEqualTo("feat: 中文提交信息");
        assertThat(status.headCommitAt()).isNotNull();
    }

    @Test
    void reportsNoUpstreamForUnpushedLocalBranch() throws Exception {
        OfflineProperties properties = properties();
        Path repo = properties.resolveRepoPath(1L);
        initRepo(repo);
        write(repo, "_flows/example/flow.yaml", "id: example\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "init");
        git(repo, "switch", "-c", "feature/local-only");

        OfflineRepoStatusService service = new OfflineRepoStatusService(properties);
        OfflineRepoStatusResponse status = service.getRepoStatus(1L);

        assertThat(status.hasUpstream()).isFalse();
        assertThat(status.hasRemote()).isFalse();
        assertThat(status.ahead()).isFalse();
        assertThat(status.dirty()).isFalse();
        assertThat(status.branch()).isEqualTo("feature/local-only");
    }

    @Test
    void reportsEmptyRepoAndDetachedHeadAccurately() throws Exception {
        OfflineProperties properties = properties();
        OfflineRepoStatusService service = new OfflineRepoStatusService(properties);

        assertThat(service.getRepoStatus(99L).exists()).isFalse();

        Path repo = properties.resolveRepoPath(2L);
        initRepo(repo);
        write(repo, "_flows/.gitkeep", "");
        OfflineRepoStatusResponse unborn = service.getRepoStatus(2L);
        assertThat(unborn.exists()).isTrue();
        assertThat(unborn.gitInitialized()).isTrue();
        assertThat(unborn.headCommitId()).isNull();
        assertThat(unborn.headCommitAt()).isNull();
        assertThat(unborn.branch()).isEqualTo("main");
        assertThat(unborn.dirty()).isTrue();

        git(repo, "add", "-A");
        git(repo, "commit", "-m", "initial");
        String sha = git(repo, "rev-parse", "HEAD");
        git(repo, "checkout", "--detach", sha);

        OfflineRepoStatusResponse detached = service.getRepoStatus(2L);
        assertThat(detached.branch()).isEqualTo("HEAD");
        assertThat(detached.headCommitId()).isEqualTo(sha);
        assertThat(detached.hasUpstream()).isFalse();
    }

    private OfflineProperties properties() {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        return properties;
    }

    private static void initRepo(Path repo) throws Exception {
        Files.createDirectories(repo);
        git(repo, "init", "-b", "main");
        git(repo, "config", "user.name", "WB Test");
        git(repo, "config", "user.email", "wb@example.com");
    }

    private static void write(Path repo, String relative, String content) throws Exception {
        Path file = repo.resolve(relative);
        Files.createDirectories(file.getParent());
        Files.writeString(file, content);
    }

    private static String git(Path repo, String... args) throws Exception {
        Process process = new ProcessBuilder(build(repo, args)).redirectErrorStream(true).start();
        int exitCode = process.waitFor();
        String output = new String(process.getInputStream().readAllBytes());
        if (exitCode != 0) {
            throw new IllegalStateException(output);
        }
        return output.trim();
    }

    private static List<String> build(Path repo, String... args) {
        java.util.ArrayList<String> command = new java.util.ArrayList<>();
        command.add("git");
        command.add("-C");
        command.add(repo.toString());
        command.addAll(List.of(args));
        return command;
    }
}
