package com.wbdata.offline.service;

import com.wbdata.git.service.GitConfigService;
import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.exception.DirtyWorkingTreeException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.Mockito;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;

class GitCommandServiceBranchTest {

    @TempDir
    Path tempDir;

    @Test
    void listBranches_returnsLocalAndRemoteOnlyBranchesWithShortNames() throws Exception {
        OfflineProperties properties = properties();
        Path repo = properties.resolveRepoPath(1L);
        Path remote = tempDir.resolve("remote.git");
        initRepoWithRemote(repo, remote);
        createRemoteOnlyBranch(remote, "feature/remote-only");
        git(repo, "fetch", "origin");

        var branches = service(properties).listBranches(1L).branches();

        assertThat(branches).anySatisfy(branch -> {
            assertThat(branch.name()).isEqualTo("main");
            assertThat(branch.local()).isTrue();
            assertThat(branch.remote()).isTrue();
            assertThat(branch.current()).isTrue();
            assertThat(branch.remoteName()).isEqualTo("origin/main");
        });
        assertThat(branches).anySatisfy(branch -> {
            assertThat(branch.name()).isEqualTo("feature/remote-only");
            assertThat(branch.local()).isFalse();
            assertThat(branch.remote()).isTrue();
            assertThat(branch.remoteName()).isEqualTo("origin/feature/remote-only");
        });
    }

    @Test
    void createBranch_rejectsDirtyWorkingTreeWithFlowSummary() throws Exception {
        OfflineProperties properties = properties();
        Path repo = properties.resolveRepoPath(1L);
        initRepo(repo);
        write(repo, "_flows/example/flow.yaml", "id: example\n");
        write(repo, "_flows/with-layout/.layout.json", "{}\n");
        write(repo, "scripts/scripted/node_1.sql", "select 1;\n");
        write(repo, "README.md", "hello\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "init");
        write(repo, "_flows/example/flow.yaml", "id: changed\n");
        write(repo, "_flows/with-layout/.layout.json", "{\"node_1\":{\"x\":1,\"y\":2}}\n");
        write(repo, "scripts/scripted/node_1.sql", "select 2;\n");
        write(repo, "README.md", "changed\n");

        DirtyWorkingTreeException ex = assertThrows(DirtyWorkingTreeException.class,
                () -> service(properties).createBranch(1L, "feature/test", "main"));

        assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(ex.getReason()).isEqualTo("工作区有未提交改动");
        assertThat(ex.details().changedFlows()).containsExactlyInAnyOrder(
                "_flows/example/flow.yaml",
                "_flows/with-layout/flow.yaml",
                "_flows/scripted/flow.yaml"
        );
        assertThat(ex.details().changedFlowDetails())
                .extracting("path", "status")
                .contains(
                        org.assertj.core.groups.Tuple.tuple("_flows/example/flow.yaml", "MODIFIED"),
                        org.assertj.core.groups.Tuple.tuple("_flows/with-layout/flow.yaml", "MODIFIED"),
                        org.assertj.core.groups.Tuple.tuple("_flows/scripted/flow.yaml", "MODIFIED")
                );
        assertThat(ex.details().otherFileCount()).isEqualTo(1);
    }

    @Test
    void createBranch_marksDeletedFlowAsDeletedInDirtySummary() throws Exception {
        OfflineProperties properties = properties();
        Path repo = properties.resolveRepoPath(1L);
        initRepo(repo);
        write(repo, "_flows/deleted/flow.yaml", "id: deleted\n");
        write(repo, "_flows/modified/flow.yaml", "id: modified\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "init");
        Files.delete(repo.resolve("_flows/deleted/flow.yaml"));
        write(repo, "_flows/modified/flow.yaml", "id: changed\n");
        write(repo, "_flows/added/flow.yaml", "id: added\n");

        DirtyWorkingTreeException ex = assertThrows(DirtyWorkingTreeException.class,
                () -> service(properties).createBranch(1L, "feature/test", "main"));

        assertThat(ex.details().changedFlowDetails())
                .extracting("path", "status")
                .containsExactlyInAnyOrder(
                        org.assertj.core.groups.Tuple.tuple("_flows/deleted/flow.yaml", "DELETED"),
                        org.assertj.core.groups.Tuple.tuple("_flows/modified/flow.yaml", "MODIFIED"),
                        org.assertj.core.groups.Tuple.tuple("_flows/added/flow.yaml", "ADDED")
                );
    }

    @Test
    void createBranch_switchesToNewBranchWhenClean() throws Exception {
        OfflineProperties properties = properties();
        Path repo = properties.resolveRepoPath(1L);
        initRepo(repo);
        write(repo, "_flows/example/flow.yaml", "id: example\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "init");

        service(properties).createBranch(1L, "feature/test", "main");

        assertThat(git(repo, "branch", "--show-current")).isEqualTo("feature/test");
    }

    @Test
    void switchBranch_createsLocalTrackingBranchForRemoteOnlyBranch() throws Exception {
        OfflineProperties properties = properties();
        Path repo = properties.resolveRepoPath(1L);
        Path remote = tempDir.resolve("remote.git");
        initRepoWithRemote(repo, remote);
        createRemoteOnlyBranch(remote, "feature/remote-only");
        git(repo, "fetch", "origin");

        service(properties).switchBranch(1L, "feature/remote-only");

        assertThat(git(repo, "branch", "--show-current")).isEqualTo("feature/remote-only");
        assertThat(git(repo, "rev-parse", "--abbrev-ref", "@{upstream}")).isEqualTo("origin/feature/remote-only");
    }

    @Test
    void mergeBranch_acceptsRemoteOnlySourceBranch() throws Exception {
        OfflineProperties properties = properties();
        Path repo = properties.resolveRepoPath(1L);
        Path remote = tempDir.resolve("remote.git");
        initRepoWithRemote(repo, remote);
        createRemoteOnlyBranch(remote, "feature/remote-only");
        git(repo, "fetch", "origin");

        service(properties).mergeBranch(1L, "feature/remote-only", "main");

        assertThat(git(repo, "branch", "--show-current")).isEqualTo("main");
        assertThat(Files.readString(repo.resolve("_flows/remote/flow.yaml"))).contains("id: remote");
    }

    @Test
    void mergeBranch_restoresOriginalActiveBranchOnSuccess() throws Exception {
        OfflineProperties properties = properties();
        Path repo = properties.resolveRepoPath(1L);
        initRepo(repo);
        write(repo, "_flows/example/flow.yaml", "id: example\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "init");

        // Create feature branch and switch to it
        git(repo, "switch", "-c", "feature/my-feature");
        write(repo, "_flows/example/flow.yaml", "id: changed-in-feature\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "feature change");

        // Merge feature/my-feature into main, while current branch is feature/my-feature
        service(properties).mergeBranch(1L, "feature/my-feature", "main");

        // Original active branch feature/my-feature should be restored after successful merge
        assertThat(git(repo, "branch", "--show-current")).isEqualTo("feature/my-feature");
        // Verify main has the merged changes
        git(repo, "switch", "main");
        assertThat(Files.readString(repo.resolve("_flows/example/flow.yaml"))).contains("id: changed-in-feature");
    }

    @Test
    void mergeBranch_reportsMissingSourceBranch() throws Exception {
        OfflineProperties properties = properties();
        Path repo = properties.resolveRepoPath(1L);
        initRepo(repo);
        write(repo, "_flows/example/flow.yaml", "id: example\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "init");

        ResponseStatusException ex = assertThrows(ResponseStatusException.class,
                () -> service(properties).mergeBranch(1L, "feature/missing", "main"));

        assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(ex.getReason()).contains("分支不存在");
    }

    @Test
    void deleteBranch_refusesCurrentBranchAndMain() throws Exception {
        OfflineProperties properties = properties();
        Path repo = properties.resolveRepoPath(1L);
        initRepo(repo);
        write(repo, "_flows/example/flow.yaml", "id: example\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "init");

        ResponseStatusException current = assertThrows(ResponseStatusException.class,
                () -> service(properties).deleteBranch(1L, "main", false));

        assertThat(current.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(current.getReason()).contains("当前分支");

        git(repo, "switch", "-c", "feature/test");
        ResponseStatusException main = assertThrows(ResponseStatusException.class,
                () -> service(properties).deleteBranch(1L, "main", false));

        assertThat(main.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(main.getReason()).contains("main");
    }

    private GitCommandService service(OfflineProperties properties) {
        return new GitCommandService(
                properties,
                Mockito.mock(GitConfigService.class),
                Mockito.mock(OfflineFlowDocumentService.class),
                new RepoLockManager()
        );
    }

    private OfflineProperties properties() {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        return properties;
    }

    private static void initRepoWithRemote(Path repo, Path remote) throws Exception {
        git(repo.getParent(), "init", "--bare", remote.toString());
        initRepo(repo);
        write(repo, "_flows/example/flow.yaml", "id: example\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "init");
        git(repo, "remote", "add", "origin", remote.toString());
        git(repo, "push", "-u", "origin", "HEAD");
    }

    private static void createRemoteOnlyBranch(Path remote, String branch) throws Exception {
        Path seed = remote.getParent().resolve("seed-" + branch.replace('/', '-'));
        git(remote.getParent(), "clone", remote.toString(), seed.toString());
        git(seed, "config", "user.name", "WB Test");
        git(seed, "config", "user.email", "wb@example.com");
        git(seed, "switch", "-c", branch);
        write(seed, "_flows/remote/flow.yaml", "id: remote\n");
        git(seed, "add", "-A");
        git(seed, "commit", "-m", "remote branch");
        git(seed, "push", "-u", "origin", "HEAD");
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
