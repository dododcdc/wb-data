package com.wbdata.offline.service;

import com.wbdata.offline.config.OfflineProperties;
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
    void reportsUpstreamWhenCurrentBranchTracksRemote() throws Exception {
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

        OfflineRepoStatusService service = new OfflineRepoStatusService(properties);

        assertThat(service.getRepoStatus(1L).hasUpstream()).isTrue();
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

        assertThat(service.getRepoStatus(1L).hasUpstream()).isFalse();
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
