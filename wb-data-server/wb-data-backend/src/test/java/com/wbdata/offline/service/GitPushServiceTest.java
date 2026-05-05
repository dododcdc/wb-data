package com.wbdata.offline.service;

import com.wbdata.git.service.GitConfigService;
import com.wbdata.offline.config.OfflineProperties;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.Mockito;
import org.springframework.web.server.ResponseStatusException;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.when;

class GitPushServiceTest {

    @TempDir
    Path tempDir;

    @Test
    void commitCurrentFlow_onlyCommitsTrackedFiles() throws Exception {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        OfflineFlowDocumentService flowDocumentService = Mockito.mock(OfflineFlowDocumentService.class);
        GitPushService service = new GitPushService(properties, Mockito.mock(GitConfigService.class), flowDocumentService);

        Path repo = properties.resolveRepoPath(1L);
        initRepo(repo);
        write(repo, "_flows/example/flow.yaml", "id: example\nnamespace: pg-1\ntasks: []\n");
        write(repo, "scripts/example/node_1.sh", "echo 1\n");
        write(repo, "scripts/other/node_9.sh", "echo 9\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "init");

        write(repo, "scripts/example/node_1.sh", "echo 2\n");
        write(repo, "scripts/other/node_9.sh", "echo 10\n");
        when(flowDocumentService.resolveManagedFiles(1L, "_flows/example/flow.yaml"))
                .thenReturn(List.of("_flows/example/flow.yaml", "scripts/example/node_1.sh"));

        service.commitCurrentFlow(1L, "_flows/example/flow.yaml", "flow only");

        assertThat(git(repo, "log", "-1", "--pretty=%s")).isEqualTo("flow only");
        assertThat(git(repo, "status", "--porcelain")).contains("scripts/other/node_9.sh");
    }

    @Test
    void commitCurrentFlow_rejectsOutOfScopeStagedChanges() throws Exception {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        OfflineFlowDocumentService flowDocumentService = Mockito.mock(OfflineFlowDocumentService.class);
        GitPushService service = new GitPushService(properties, Mockito.mock(GitConfigService.class), flowDocumentService);

        Path repo = properties.resolveRepoPath(1L);
        initRepo(repo);
        write(repo, "_flows/example/flow.yaml", "id: example\nnamespace: pg-1\ntasks: []\n");
        write(repo, "scripts/example/node_1.sh", "echo 1\n");
        write(repo, "scripts/other/node_9.sh", "echo 9\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "init");

        write(repo, "scripts/other/node_9.sh", "echo 10\n");
        git(repo, "add", "scripts/other/node_9.sh");
        when(flowDocumentService.resolveManagedFiles(1L, "_flows/example/flow.yaml"))
                .thenReturn(List.of("_flows/example/flow.yaml", "scripts/example/node_1.sh"));

        ResponseStatusException ex = assertThrows(ResponseStatusException.class,
                () -> service.commitCurrentFlow(1L, "_flows/example/flow.yaml", "flow only"));

        assertThat(ex.getReason()).contains("已暂存");
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
