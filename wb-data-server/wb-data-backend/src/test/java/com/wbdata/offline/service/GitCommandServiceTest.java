package com.wbdata.offline.service;

import com.wbdata.git.service.GitConfigService;
import com.wbdata.git.service.provider.GitRemoteProvider;
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

class GitCommandServiceTest {

    @TempDir
    Path tempDir;

    @Test
    void commitCurrentFlow_onlyCommitsTrackedFiles() throws Exception {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        OfflineFlowDocumentService flowDocumentService = Mockito.mock(OfflineFlowDocumentService.class);
        GitCommandService service = new GitCommandService(properties, Mockito.mock(GitConfigService.class), flowDocumentService, new RepoLockManager());

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
        GitCommandService service = new GitCommandService(properties, Mockito.mock(GitConfigService.class), flowDocumentService, new RepoLockManager());

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

    @Test
    void push_pushesCurrentHeadBranch() throws Exception {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        OfflineFlowDocumentService flowDocumentService = Mockito.mock(OfflineFlowDocumentService.class);
        GitConfigService gitConfigService = Mockito.mock(GitConfigService.class);
        GitRemoteProvider provider = Mockito.mock(GitRemoteProvider.class);
        when(gitConfigService.getProvider(1L)).thenReturn(provider);
        when(provider.repositoryExists("wb-data-1")).thenReturn(true);
        GitCommandService service = new GitCommandService(properties, gitConfigService, flowDocumentService, new RepoLockManager());

        Path repo = properties.resolveRepoPath(1L);
        Path remote = tempDir.resolve("remote.git");
        git(tempDir, "init", "--bare", remote.toString());
        when(provider.buildDisplayUrl("wb-data-1")).thenReturn(remote.toUri().toString());
        when(provider.buildPushUrl("wb-data-1")).thenReturn(remote.toUri().toString());
        initRepo(repo);
        write(repo, "_flows/example/flow.yaml", "id: example\nnamespace: pg-1\ntasks: []\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "init");
        git(repo, "remote", "add", "origin", remote.toString());
        git(repo, "switch", "-c", "feature/pipeline");
        write(repo, "_flows/example/flow.yaml", "id: example\nnamespace: pg-1\ntasks:\n  - id: node_1\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "feature change");

        service.push(1L);

        assertThat(git(repo, "ls-remote", "--heads", "origin", "feature/pipeline"))
                .contains("refs/heads/feature/pipeline");
    }

    @Test
    void push_replacesStaleOriginWhenConfiguredRemoteChanges() throws Exception {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        OfflineFlowDocumentService flowDocumentService = Mockito.mock(OfflineFlowDocumentService.class);
        GitConfigService gitConfigService = Mockito.mock(GitConfigService.class);
        GitRemoteProvider provider = Mockito.mock(GitRemoteProvider.class);
        when(gitConfigService.getProvider(1L)).thenReturn(provider);
        when(provider.repositoryExists("wb-data-1")).thenReturn(true);
        GitCommandService service = new GitCommandService(properties, gitConfigService, flowDocumentService, new RepoLockManager());

        Path repo = properties.resolveRepoPath(1L);
        Path oldRemote = tempDir.resolve("old-remote.git");
        Path newRemote = tempDir.resolve("new-remote.git");
        git(tempDir, "init", "--bare", oldRemote.toString());
        git(tempDir, "init", "--bare", newRemote.toString());
        when(provider.buildDisplayUrl("wb-data-1")).thenReturn(newRemote.toUri().toString());
        when(provider.buildPushUrl("wb-data-1")).thenReturn(newRemote.toUri().toString());

        initRepo(repo);
        write(repo, "_flows/example/flow.yaml", "id: example\nnamespace: pg-1\ntasks: []\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "init");
        git(repo, "remote", "add", "origin", oldRemote.toUri().toString());

        service.push(1L);

        assertThat(git(repo, "remote", "get-url", "origin")).isEqualTo(newRemote.toUri().toString());
        assertThat(git(repo, "ls-remote", "--heads", newRemote.toUri().toString(), "main"))
                .contains("refs/heads/main");
        assertThat(git(repo, "ls-remote", "--heads", oldRemote.toUri().toString(), "main")).isBlank();
    }

    @Test
    void push_abortsRebaseWhenPullRebaseConflicts() throws Exception {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        OfflineFlowDocumentService flowDocumentService = Mockito.mock(OfflineFlowDocumentService.class);
        GitConfigService gitConfigService = Mockito.mock(GitConfigService.class);
        GitRemoteProvider provider = Mockito.mock(GitRemoteProvider.class);
        when(gitConfigService.getProvider(1L)).thenReturn(provider);
        when(provider.repositoryExists("wb-data-1")).thenReturn(true);
        GitCommandService service = new GitCommandService(properties, gitConfigService, flowDocumentService, new RepoLockManager());

        Path repo = properties.resolveRepoPath(1L);
        Path remote = tempDir.resolve("remote.git");
        Path otherClone = tempDir.resolve("other-clone");
        git(tempDir, "init", "--bare", remote.toString());
        when(provider.buildDisplayUrl("wb-data-1")).thenReturn(remote.toUri().toString());
        when(provider.buildPushUrl("wb-data-1")).thenReturn(remote.toUri().toString());
        initRepo(repo);
        write(repo, "_flows/example/flow.yaml", "id: example\nnamespace: pg-1\ntasks: []\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "init");
        git(repo, "remote", "add", "origin", remote.toUri().toString());
        git(repo, "push", "-u", "origin", "HEAD");
        git(repo, "switch", "-c", "feature/conflict");
        write(repo, "_flows/example/flow.yaml", "id: feature-base\nnamespace: pg-1\ntasks: []\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "feature base");
        git(repo, "push", "-u", "origin", "HEAD");

        git(tempDir, "clone", remote.toUri().toString(), otherClone.toString());
        git(otherClone, "config", "user.name", "WB Test");
        git(otherClone, "config", "user.email", "wb@example.com");
        git(otherClone, "switch", "feature/conflict");
        write(otherClone, "_flows/example/flow.yaml", "id: remote-change\nnamespace: pg-1\ntasks: []\n");
        git(otherClone, "add", "-A");
        git(otherClone, "commit", "-m", "remote change");
        git(otherClone, "push");

        write(repo, "_flows/example/flow.yaml", "id: local-change\nnamespace: pg-1\ntasks: []\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "local change");

        ResponseStatusException ex = assertThrows(ResponseStatusException.class, () -> service.push(1L));

        assertThat(ex.getReason()).contains("推送失败");
        assertThat(Files.exists(repo.resolve(".git/rebase-merge"))).isFalse();
        assertThat(Files.exists(repo.resolve(".git/rebase-apply"))).isFalse();
        assertThat(git(repo, "branch", "--show-current")).isEqualTo("feature/conflict");
        assertThat(git(repo, "status", "--porcelain")).isBlank();
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
