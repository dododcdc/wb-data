package com.wbdata.offline.repo.service;

import com.wbdata.git.entity.WbOfflinePublishRecord;
import com.wbdata.git.service.OfflinePublishRecordService;
import com.wbdata.offline.service.OfflineFlowDocumentService;

import com.wbdata.offline.config.OfflineProperties;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.Mockito;
import org.springframework.web.server.ResponseStatusException;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
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
        GitCommandService service = new GitCommandService(properties, Mockito.mock(OfflineGitRemotePort.class), flowDocumentService, publishRecordService(), new RepoLockManager());

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
        GitCommandService service = new GitCommandService(properties, Mockito.mock(OfflineGitRemotePort.class), flowDocumentService, publishRecordService(), new RepoLockManager());

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
    void commitCurrentFlow_commitsDeletionWhenHiveConfSidecarClearedFromDisk() throws Exception {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        OfflineFlowDocumentService flowDocumentService = Mockito.mock(OfflineFlowDocumentService.class);
        GitCommandService service = new GitCommandService(properties, Mockito.mock(OfflineGitRemotePort.class), flowDocumentService, publishRecordService(), new RepoLockManager());

        Path repo = properties.resolveRepoPath(1L);
        initRepo(repo);
        write(repo, "_flows/example/flow.yaml", "id: example\nnamespace: pg-1\ntasks: []\n");
        write(repo, "_flows/example/.hive-conf.json", "{\"schemaVersion\":1}\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "with hive conf");

        Files.delete(repo.resolve("_flows/example/.hive-conf.json"));
        when(flowDocumentService.resolveManagedFiles(1L, "_flows/example/flow.yaml"))
                .thenReturn(List.of("_flows/example/flow.yaml"));

        assertThat(service.hasFlowChanges(1L, "_flows/example/flow.yaml")).isTrue();
        service.commitCurrentFlow(1L, "_flows/example/flow.yaml", "clear hive conf");
        assertThat(git(repo, "status", "--porcelain")).isBlank();
        assertThat(git(repo, "log", "-1", "--pretty=%s")).isEqualTo("clear hive conf");
    }

    @Test
    void push_pushesCurrentHeadBranch() throws Exception {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        OfflineFlowDocumentService flowDocumentService = Mockito.mock(OfflineFlowDocumentService.class);
        OfflineGitRemotePort gitRemotePort = Mockito.mock(OfflineGitRemotePort.class);
        when(gitRemotePort.repositoryExists(1L, "wb-data-1")).thenReturn(true);
        GitCommandService service = new GitCommandService(properties, gitRemotePort, flowDocumentService, publishRecordService(), new RepoLockManager());

        Path repo = properties.resolveRepoPath(1L);
        Path remote = tempDir.resolve("remote.git");
        git(tempDir, "init", "--bare", remote.toString());
        when(gitRemotePort.buildDisplayUrl(1L, "wb-data-1")).thenReturn(remote.toUri().toString());
        when(gitRemotePort.buildPushUrl(1L, "wb-data-1")).thenReturn(remote.toUri().toString());
        initRepo(repo);
        write(repo, "_flows/example/flow.yaml", "id: example\nnamespace: pg-1\ntasks: []\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "init");
        git(repo, "remote", "add", "origin", remote.toString());
        git(repo, "switch", "-c", "feature/pipeline");
        write(repo, "_flows/example/flow.yaml", "id: example\nnamespace: pg-1\ntasks:\n  - id: node_1\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "feature change");

        service.push(1L, 9L);

        assertThat(git(repo, "ls-remote", "--heads", "origin", "feature/pipeline"))
                .contains("refs/heads/feature/pipeline");
    }

    @Test
    void push_publishesCurrentBranchAfterSuccessfulPush() throws Exception {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        OfflineFlowDocumentService flowDocumentService = Mockito.mock(OfflineFlowDocumentService.class);
        OfflineGitRemotePort gitRemotePort = Mockito.mock(OfflineGitRemotePort.class);
        when(gitRemotePort.repositoryExists(1L, "wb-data-1")).thenReturn(true);
        GitCommandService service = new GitCommandService(properties, gitRemotePort, flowDocumentService, publishRecordService(), new RepoLockManager());
        List<Object> events = new ArrayList<>();
        service.setApplicationEventPublisher(events::add);

        Path repo = properties.resolveRepoPath(1L);
        Path remote = tempDir.resolve("remote.git");
        git(tempDir, "init", "--bare", remote.toString());
        when(gitRemotePort.buildDisplayUrl(1L, "wb-data-1")).thenReturn(remote.toUri().toString());
        when(gitRemotePort.buildPushUrl(1L, "wb-data-1")).thenReturn(remote.toUri().toString());
        initRepo(repo);
        write(repo, "_flows/example/flow.yaml", "id: example\nnamespace: pg-1\ntasks: []\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "init");
        git(repo, "remote", "add", "origin", remote.toString());
        git(repo, "switch", "-c", "feature/policy-review");
        write(repo, "_flows/example/flow.yaml", "id: example\nnamespace: pg-1\ntasks:\n  - id: node_1\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "feature change");

        service.push(1L, 9L);

        assertThat(events).hasSize(1);
        GitRepoPushedEvent event = (GitRepoPushedEvent) events.get(0);
        assertThat(event.publishRecordId()).isEqualTo(99L);
        assertThat(event.groupId()).isEqualTo(1L);
        assertThat(event.branch()).isEqualTo("feature/policy-review");
        assertThat(event.beforeSha()).isNull();
        assertThat(event.afterSha()).isEqualTo(git(repo, "rev-parse", "HEAD"));
    }

    @Test
    void push_replacesStaleOriginWhenConfiguredRemoteChanges() throws Exception {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        OfflineFlowDocumentService flowDocumentService = Mockito.mock(OfflineFlowDocumentService.class);
        OfflineGitRemotePort gitRemotePort = Mockito.mock(OfflineGitRemotePort.class);
        when(gitRemotePort.repositoryExists(1L, "wb-data-1")).thenReturn(true);
        GitCommandService service = new GitCommandService(properties, gitRemotePort, flowDocumentService, publishRecordService(), new RepoLockManager());

        Path repo = properties.resolveRepoPath(1L);
        Path oldRemote = tempDir.resolve("old-remote.git");
        Path newRemote = tempDir.resolve("new-remote.git");
        git(tempDir, "init", "--bare", oldRemote.toString());
        git(tempDir, "init", "--bare", newRemote.toString());
        when(gitRemotePort.buildDisplayUrl(1L, "wb-data-1")).thenReturn(newRemote.toUri().toString());
        when(gitRemotePort.buildPushUrl(1L, "wb-data-1")).thenReturn(newRemote.toUri().toString());

        initRepo(repo);
        write(repo, "_flows/example/flow.yaml", "id: example\nnamespace: pg-1\ntasks: []\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "init");
        git(repo, "remote", "add", "origin", oldRemote.toUri().toString());

        service.push(1L, 9L);

        assertThat(git(repo, "remote", "get-url", "origin")).isEqualTo(newRemote.toUri().toString());
        assertThat(git(repo, "ls-remote", "--heads", newRemote.toUri().toString(), "main"))
                .contains("refs/heads/main");
        assertThat(git(repo, "ls-remote", "--heads", oldRemote.toUri().toString(), "main")).isBlank();
    }

    @Test
    void push_rebasesBeforeRecordingRevisionRange() throws Exception {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        OfflineFlowDocumentService flowDocumentService = Mockito.mock(OfflineFlowDocumentService.class);
        OfflineGitRemotePort gitRemotePort = Mockito.mock(OfflineGitRemotePort.class);
        OfflinePublishRecordService publishRecordService = publishRecordService();
        when(gitRemotePort.repositoryExists(1L, "wb-data-1")).thenReturn(true);
        GitCommandService service = new GitCommandService(
                properties, gitRemotePort, flowDocumentService, publishRecordService, new RepoLockManager());

        Path repo = properties.resolveRepoPath(1L);
        Path remote = tempDir.resolve("remote.git");
        Path otherClone = tempDir.resolve("other-clone");
        git(tempDir, "init", "--bare", remote.toString());
        when(gitRemotePort.buildDisplayUrl(1L, "wb-data-1")).thenReturn(remote.toUri().toString());
        when(gitRemotePort.buildPushUrl(1L, "wb-data-1")).thenReturn(remote.toUri().toString());
        initRepo(repo);
        write(repo, "_flows/example/flow.yaml", "id: example\nnamespace: pg-1\ntasks: []\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "init");
        git(repo, "remote", "add", "origin", remote.toUri().toString());
        git(repo, "push", "-u", "origin", "HEAD");

        git(tempDir, "clone", "--branch", "main", remote.toUri().toString(), otherClone.toString());
        git(otherClone, "config", "user.name", "WB Test");
        git(otherClone, "config", "user.email", "wb@example.com");
        write(otherClone, "remote.txt", "remote\n");
        git(otherClone, "add", "-A");
        git(otherClone, "commit", "-m", "remote change");
        git(otherClone, "push");
        String expectedBefore = git(otherClone, "rev-parse", "HEAD");

        assertThat(git(repo, "ls-remote", "--heads", "origin", "refs/heads/main"))
                .startsWith(expectedBefore);

        write(repo, "local.txt", "local\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "local change");

        service.push(1L, 9L);

        String expectedAfter = git(repo, "rev-parse", "HEAD");
        Mockito.verify(publishRecordService).recordPush(
                Mockito.eq(1L), Mockito.eq(9L), Mockito.eq("main"),
                Mockito.eq(expectedBefore), Mockito.eq(expectedAfter));
    }

    @Test
    void push_abortsRebaseWhenPullRebaseConflicts() throws Exception {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        OfflineFlowDocumentService flowDocumentService = Mockito.mock(OfflineFlowDocumentService.class);
        OfflineGitRemotePort gitRemotePort = Mockito.mock(OfflineGitRemotePort.class);
        when(gitRemotePort.repositoryExists(1L, "wb-data-1")).thenReturn(true);
        GitCommandService service = new GitCommandService(properties, gitRemotePort, flowDocumentService, publishRecordService(), new RepoLockManager());

        Path repo = properties.resolveRepoPath(1L);
        Path remote = tempDir.resolve("remote.git");
        Path otherClone = tempDir.resolve("other-clone");
        git(tempDir, "init", "--bare", remote.toString());
        when(gitRemotePort.buildDisplayUrl(1L, "wb-data-1")).thenReturn(remote.toUri().toString());
        when(gitRemotePort.buildPushUrl(1L, "wb-data-1")).thenReturn(remote.toUri().toString());
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

        ResponseStatusException ex = assertThrows(ResponseStatusException.class, () -> service.push(1L, 9L));

        assertThat(ex.getReason()).contains("推送失败");
        assertThat(Files.exists(repo.resolve(".git/rebase-merge"))).isFalse();
        assertThat(Files.exists(repo.resolve(".git/rebase-apply"))).isFalse();
        assertThat(git(repo, "branch", "--show-current")).isEqualTo("feature/conflict");
        assertThat(git(repo, "status", "--porcelain")).isBlank();
    }

    @Test
    void commitCurrentFlow_stagesAndCommitsDeletedFlowFilesAfterRollback() throws Exception {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        OfflineFlowDocumentService flowDocumentService = Mockito.mock(OfflineFlowDocumentService.class);
        GitCommandService service = new GitCommandService(
                properties, Mockito.mock(OfflineGitRemotePort.class), flowDocumentService, publishRecordService(), new RepoLockManager());

        Path repo = properties.resolveRepoPath(1L);
        initRepo(repo);
        write(repo, "_flows/example/flow.yaml", "id: example\nnamespace: pg-1\ntasks: []\n");
        write(repo, "_flows/example/.layout.json", "{\"n1\":{\"x\":10,\"y\":20}}");
        write(repo, "scripts/example/stale.sql", "SELECT 1;\n");
        write(repo, "transfers/example/t1.transfer.json", "{\"version\":1}\n");
        write(repo, ".wb-data/kestra-flows/example.yaml", "id: example\nnamespace: pg-1\ntasks: []\n");
        write(repo, "scripts/other/keep.sql", "SELECT 2;\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "v2");

        // Simulate rollback deleting stale script, transfer config, and layout sidecar while updating flow.yaml
        Files.delete(repo.resolve("scripts/example/stale.sql"));
        Files.delete(repo.resolve("transfers/example/t1.transfer.json"));
        Files.delete(repo.resolve("_flows/example/.layout.json"));
        write(repo, "_flows/example/flow.yaml", "id: example\nnamespace: pg-1\ntasks:\n  - id: n1\n");
        write(repo, ".wb-data/kestra-flows/example.yaml", "id: example\nnamespace: pg-1\ntasks:\n  - id: n1\n");
        when(flowDocumentService.resolveManagedFiles(1L, "_flows/example/flow.yaml"))
                .thenReturn(List.of("_flows/example/flow.yaml", ".wb-data/kestra-flows/example.yaml"));

        service.commitCurrentFlow(1L, "_flows/example/flow.yaml", "commit rollback");

        assertThat(git(repo, "log", "-1", "--pretty=%s")).isEqualTo("commit rollback");
        String headFiles = git(repo, "ls-tree", "-r", "--name-only", "HEAD");
        assertThat(headFiles)
                .doesNotContain("scripts/example/stale.sql")
                .doesNotContain("transfers/example/t1.transfer.json")
                .doesNotContain("_flows/example/.layout.json")
                .contains("scripts/other/keep.sql");
    }

    @Test
    void pushCurrentFlow_isolatesSingleFlowWhenOtherFlowsHaveUnpushedCommitsAndPreservesDirtyWorktree() throws Exception {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        OfflineFlowDocumentService flowDocumentService = Mockito.mock(OfflineFlowDocumentService.class);
        OfflineGitRemotePort gitRemotePort = Mockito.mock(OfflineGitRemotePort.class);
        OfflinePublishRecordService publishRecordService = publishRecordService();
        when(gitRemotePort.repositoryExists(1L, "wb-data-1")).thenReturn(true);
        GitCommandService service = new GitCommandService(
                properties, gitRemotePort, flowDocumentService, publishRecordService, new RepoLockManager());
        List<Object> events = new ArrayList<>();
        service.setApplicationEventPublisher(events::add);

        Path repo = properties.resolveRepoPath(1L);
        Path remote = tempDir.resolve("remote.git");
        git(tempDir, "init", "--bare", remote.toString());
        when(gitRemotePort.buildDisplayUrl(1L, "wb-data-1")).thenReturn(remote.toUri().toString());
        when(gitRemotePort.buildPushUrl(1L, "wb-data-1")).thenReturn(remote.toUri().toString());
        initRepo(repo);
        write(repo, "_flows/example/flow.yaml", "id: example\nnamespace: pg-1\ntasks: []\n");
        write(repo, "scripts/example/n1.sh", "echo example-v1\n");
        write(repo, "_flows/other/flow.yaml", "id: other\nnamespace: pg-1\ntasks: []\n");
        write(repo, "scripts/other/o1.sh", "echo other-v1\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "init");
        git(repo, "remote", "add", "origin", remote.toUri().toString());
        git(repo, "push", "-u", "origin", "HEAD");
        String initialSha = git(repo, "rev-parse", "HEAD");

        // Another user commits 'other', then developer commits 'example', plus keeps dirty edits on 'other'
        write(repo, "scripts/other/o1.sh", "echo other-v2-committed\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "feat: update other");

        write(repo, "scripts/example/n1.sh", "echo example-v2-committed\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "feat: update example");

        write(repo, "scripts/other/o1.sh", "echo other-v3-uncommitted\n");

        when(flowDocumentService.resolveManagedFiles(1L, "_flows/example/flow.yaml"))
                .thenReturn(List.of("_flows/example/flow.yaml", "scripts/example/n1.sh"));
        when(flowDocumentService.resolveManagedFiles(1L, "_flows/other/flow.yaml"))
                .thenReturn(List.of("_flows/other/flow.yaml", "scripts/other/o1.sh"));

        GitCommandService.PushResult result = service.pushCurrentFlow(1L, "_flows/example/flow.yaml", 9L);

        assertThat(result.success()).isTrue();
        assertThat(result.message()).isEqualTo("当前任务推送成功");

        String remoteMainSha = git(repo, "ls-remote", "--heads", "origin", "refs/heads/main").split("\\s+")[0];
        assertThat(git(repo, "show", remoteMainSha + ":scripts/example/n1.sh")).isEqualTo("echo example-v2-committed");
        assertThat(git(repo, "show", remoteMainSha + ":scripts/other/o1.sh")).isEqualTo("echo other-v1");
        assertThat(git(repo, "log", "-1", "--pretty=%s", remoteMainSha)).isEqualTo("feat: update example");

        assertThat(service.hasUnpushedFlowChanges(1L, "_flows/example/flow.yaml")).isFalse();
        assertThat(service.hasUnpushedFlowChanges(1L, "_flows/other/flow.yaml")).isTrue();
        assertThat(git(repo, "show", "HEAD:scripts/other/o1.sh")).isEqualTo("echo other-v2-committed");
        assertThat(Files.readString(repo.resolve("scripts/other/o1.sh"))).isEqualTo("echo other-v3-uncommitted\n");

        Mockito.verify(publishRecordService).recordPush(
                Mockito.eq(1L), Mockito.eq(9L), Mockito.eq("main"),
                Mockito.eq(initialSha), Mockito.eq(remoteMainSha));
        assertThat(events).hasSize(1);
    }

    @Test
    void pushCurrentFlow_rejectsWhenFlowHasUncommittedChangesAndNoCommittedDiff() throws Exception {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        OfflineFlowDocumentService flowDocumentService = Mockito.mock(OfflineFlowDocumentService.class);
        OfflineGitRemotePort gitRemotePort = Mockito.mock(OfflineGitRemotePort.class);
        when(gitRemotePort.repositoryExists(1L, "wb-data-1")).thenReturn(true);
        GitCommandService service = new GitCommandService(
                properties, gitRemotePort, flowDocumentService, publishRecordService(), new RepoLockManager());

        Path repo = properties.resolveRepoPath(1L);
        Path remote = tempDir.resolve("remote.git");
        git(tempDir, "init", "--bare", remote.toString());
        when(gitRemotePort.buildDisplayUrl(1L, "wb-data-1")).thenReturn(remote.toUri().toString());
        when(gitRemotePort.buildPushUrl(1L, "wb-data-1")).thenReturn(remote.toUri().toString());
        initRepo(repo);
        write(repo, "_flows/example/flow.yaml", "id: example\nnamespace: pg-1\ntasks: []\n");
        write(repo, "scripts/example/n1.sh", "echo v1\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "init");
        git(repo, "remote", "add", "origin", remote.toUri().toString());
        git(repo, "push", "-u", "origin", "HEAD");

        write(repo, "scripts/example/n1.sh", "echo uncommitted\n");
        when(flowDocumentService.resolveManagedFiles(1L, "_flows/example/flow.yaml"))
                .thenReturn(List.of("_flows/example/flow.yaml", "scripts/example/n1.sh"));

        ResponseStatusException ex = assertThrows(ResponseStatusException.class,
                () -> service.pushCurrentFlow(1L, "_flows/example/flow.yaml", 9L));

        assertThat(ex.getReason()).contains("未提交");
    }

    @Test
    void pushCurrentFlow_rejectsWhenRemoteBranchHasNewCommitToSameFlow() throws Exception {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        OfflineFlowDocumentService flowDocumentService = Mockito.mock(OfflineFlowDocumentService.class);
        OfflineGitRemotePort gitRemotePort = Mockito.mock(OfflineGitRemotePort.class);
        when(gitRemotePort.repositoryExists(1L, "wb-data-1")).thenReturn(true);
        GitCommandService service = new GitCommandService(
                properties, gitRemotePort, flowDocumentService, publishRecordService(), new RepoLockManager());

        Path repo = properties.resolveRepoPath(1L);
        Path remote = tempDir.resolve("remote.git");
        Path otherClone = tempDir.resolve("other-clone");
        git(tempDir, "init", "--bare", remote.toString());
        when(gitRemotePort.buildDisplayUrl(1L, "wb-data-1")).thenReturn(remote.toUri().toString());
        when(gitRemotePort.buildPushUrl(1L, "wb-data-1")).thenReturn(remote.toUri().toString());
        initRepo(repo);
        write(repo, "_flows/example/flow.yaml", "id: example\nnamespace: pg-1\ntasks: []\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "init");
        git(repo, "remote", "add", "origin", remote.toUri().toString());
        git(repo, "push", "-u", "origin", "HEAD");

        git(tempDir, "clone", "--branch", "main", remote.toUri().toString(), otherClone.toString());
        git(otherClone, "config", "user.name", "Remote Dev");
        git(otherClone, "config", "user.email", "remote@example.com");
        write(otherClone, "_flows/example/flow.yaml", "id: example\nnamespace: pg-1\ndesc: remote\ntasks: []\n");
        git(otherClone, "add", "-A");
        git(otherClone, "commit", "-m", "remote example edit");
        git(otherClone, "push");

        write(repo, "_flows/example/flow.yaml", "id: example\nnamespace: pg-1\ndesc: local\ntasks: []\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "local example edit");
        when(flowDocumentService.resolveManagedFiles(1L, "_flows/example/flow.yaml"))
                .thenReturn(List.of("_flows/example/flow.yaml"));

        ResponseStatusException ex = assertThrows(ResponseStatusException.class,
                () -> service.pushCurrentFlow(1L, "_flows/example/flow.yaml", 9L));

        assertThat(ex.getReason()).contains("当前任务已有新提交");
    }

    private static OfflinePublishRecordService publishRecordService() {
        OfflinePublishRecordService service = Mockito.mock(OfflinePublishRecordService.class);
        when(service.recordPush(
                Mockito.anyLong(), Mockito.nullable(Long.class), Mockito.anyString(), Mockito.any(), Mockito.anyString()))
                .thenAnswer(invocation -> {
                    WbOfflinePublishRecord record = new WbOfflinePublishRecord();
                    record.setId(99L);
                    record.setBeforeSha(invocation.getArgument(3));
                    record.setAfterSha(invocation.getArgument(4));
                    return record;
                });
        return service;
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
