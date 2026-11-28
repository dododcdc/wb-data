package com.wbdata.offline.repo.service;

import com.sun.net.httpserver.HttpServer;
import com.wbdata.offline.service.OfflineFlowDocumentService;

import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.repo.dto.BranchItemResponse;
import com.wbdata.offline.exception.DirtyWorkingTreeException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.Mockito;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;
import java.util.zip.GZIPInputStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.when;

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
        assertThat(branches)
                .extracting(BranchItemResponse::name)
                .containsExactlyInAnyOrder("main", "feature/remote-only");
    }

    @Test
    void listRemoteBranchNames_refreshesOriginAndExcludesLocalOnlyAndDeletedBranches() throws Exception {
        OfflineProperties properties = properties();
        Path repo = properties.resolveRepoPath(1L);
        Path remote = tempDir.resolve("remote.git");
        initRepoWithRemote(repo, remote);

        git(repo, "switch", "-c", "feature/local-only");
        createRemoteOnlyBranch(remote, "feature/deleted-remotely");
        git(repo, "fetch", "origin");
        git(remote, "update-ref", "-d", "refs/heads/feature/deleted-remotely");
        createRemoteOnlyBranch(remote, "feature/remote-only");

        List<String> branches = service(properties).listRemoteBranchNames(1L);

        assertThat(branches).containsExactly("feature/remote-only", "main");
    }

    @Test
    void listRemoteBranchNames_returnsEmptyWhenOriginIsMissing() throws Exception {
        OfflineProperties properties = properties();
        Path repo = properties.resolveRepoPath(1L);
        initRepo(repo);

        assertThat(service(properties).listRemoteBranchNames(1L)).isEmpty();
    }

    @Test
    void listRemoteBranchNames_scrubsLegacyHttpOriginAndAuthenticatesViaAskPass() throws Exception {
        OfflineProperties properties = properties();
        Path repo = properties.resolveRepoPath(1L);
        Path remote = tempDir.resolve("remote-http.git");
        initRepoWithRemote(repo, remote);
        createRemoteOnlyBranch(remote, "feature/remote-auth");

        AtomicReference<String> capturedAuth = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            String auth = exchange.getRequestHeaders().getFirst("Authorization");
            if (auth == null || !auth.startsWith("Basic ")) {
                exchange.getResponseHeaders().add("WWW-Authenticate", "Basic realm=\"wb-data\"");
                exchange.sendResponseHeaders(401, -1);
                exchange.close();
                return;
            }
            capturedAuth.set(new String(
                    Base64.getDecoder().decode(auth.substring("Basic ".length()).trim()),
                    StandardCharsets.UTF_8));
            String path = exchange.getRequestURI().getPath();
            String query = exchange.getRequestURI().getRawQuery();
            try {
                if (path.endsWith("/info/refs") && "service=git-upload-pack".equals(query)) {
                    byte[] refs = runGitRpc(remote, new byte[0], "--advertise-refs");
                    ByteArrayOutputStream body = new ByteArrayOutputStream();
                    body.write("001e# service=git-upload-pack\n0000".getBytes(StandardCharsets.UTF_8));
                    body.write(refs);
                    byte[] bytes = body.toByteArray();
                    exchange.getResponseHeaders().set("Content-Type", "application/x-git-upload-pack-advertisement");
                    exchange.sendResponseHeaders(200, bytes.length);
                    exchange.getResponseBody().write(bytes);
                    return;
                }
                if (path.endsWith("/git-upload-pack") && "POST".equalsIgnoreCase(exchange.getRequestMethod())) {
                    String contentEncoding = exchange.getRequestHeaders().getFirst("Content-Encoding");
                    byte[] reqBody;
                    try (InputStream is = "gzip".equalsIgnoreCase(contentEncoding)
                            ? new GZIPInputStream(exchange.getRequestBody())
                            : exchange.getRequestBody()) {
                        reqBody = is.readAllBytes();
                    }
                    byte[] rpcOut = runGitRpc(remote, reqBody);
                    exchange.getResponseHeaders().set("Content-Type", "application/x-git-upload-pack-result");
                    exchange.sendResponseHeaders(200, rpcOut.length);
                    exchange.getResponseBody().write(rpcOut);
                    return;
                }
                exchange.sendResponseHeaders(404, -1);
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
                exchange.sendResponseHeaders(500, -1);
            } finally {
                exchange.close();
            }
        });
        server.start();
        try {
            OfflineGitRemotePort remotePort = Mockito.mock(OfflineGitRemotePort.class);
            when(remotePort.resolveCredentials(1L))
                    .thenReturn(Optional.of(new OfflineGitRemotePort.GitRemoteCredentials("alice", "glpat_branch_secret")));
            GitCommandService gitCommandService = new GitCommandService(
                    properties,
                    remotePort,
                    Mockito.mock(OfflineFlowDocumentService.class),
                    Mockito.mock(OfflinePublishHistoryPort.class),
                    new RepoLockManager()
            );

            String legacyUrl = "http://alice:old_secret@127.0.0.1:" + server.getAddress().getPort() + "/wb-data-1.git";
            String cleanUrl = "http://127.0.0.1:" + server.getAddress().getPort() + "/wb-data-1.git";
            git(repo, "remote", "set-url", "origin", legacyUrl);

            List<String> branches = gitCommandService.listRemoteBranchNames(1L);

            assertThat(branches).containsExactly("feature/remote-auth", "main");
            assertThat(capturedAuth.get()).isEqualTo("alice:glpat_branch_secret");
            assertThat(git(repo, "remote", "get-url", "origin")).isEqualTo(cleanUrl);
            assertThat(Files.readString(repo.resolve(".git/config")))
                    .doesNotContain("old_secret")
                    .doesNotContain("glpat_branch_secret");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void listRemoteBranchNames_fallsBackToCachedRemoteRefsWhenFetchFails() throws Exception {
        OfflineProperties properties = properties();
        Path repo = properties.resolveRepoPath(1L);
        Path remote = tempDir.resolve("remote-cached.git");
        initRepoWithRemote(repo, remote);
        createRemoteOnlyBranch(remote, "feature/cached");
        git(repo, "fetch", "origin");
        git(repo, "remote", "set-url", "origin", "http://127.0.0.1:1/unreachable.git");

        List<String> branches = service(properties).listRemoteBranchNames(1L);

        assertThat(branches).containsExactly("feature/cached", "main");
    }

    @Test
    void listRemoteBranchNames_throwsBadGatewayWhenFetchFailsWithoutCachedRefs() throws Exception {
        OfflineProperties properties = properties();
        Path repo = properties.resolveRepoPath(1L);
        initRepo(repo);
        git(repo, "remote", "add", "origin", "http://127.0.0.1:1/unreachable.git");

        ResponseStatusException ex = assertThrows(ResponseStatusException.class,
                () -> service(properties).listRemoteBranchNames(1L));

        assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.BAD_GATEWAY);
        assertThat(ex.getReason()).contains("无法连接远程 Git 仓库");
    }

    private static byte[] runGitRpc(Path bareRemote, byte[] input, String... extraArgs) throws IOException, InterruptedException {
        java.util.ArrayList<String> cmd = new java.util.ArrayList<>();
        cmd.add("git");
        cmd.add("upload-pack");
        cmd.add("--stateless-rpc");
        cmd.addAll(List.of(extraArgs));
        cmd.add(bareRemote.toString());
        Process process = new ProcessBuilder(cmd).start();
        try (var out = process.getOutputStream()) {
            if (input.length > 0) {
                out.write(input);
            }
        }
        byte[] stdout = process.getInputStream().readAllBytes();
        int exit = process.waitFor();
        if (exit != 0) {
            throw new IOException("git upload-pack failed with exit code " + exit);
        }
        return stdout;
    }

    @Test
    void mergeBranch_rejectsDirtyTargetWorkingTreeWithFlowSummary() throws Exception {
        OfflineProperties properties = properties();
        Path repo = properties.resolveRepoPath(1L);
        initRepo(repo);
        write(repo, "_flows/example/flow.yaml", "id: example\n");
        write(repo, "_flows/with-layout/.layout.json", "{}\n");
        write(repo, "_flows/with-parameters/.parameters.json", "{}\n");
        write(repo, "_flows/with-hive-conf/.hive-conf.json", "{}\n");
        write(repo, "scripts/scripted/node_1.sql", "select 1;\n");
        write(repo, "README.md", "hello\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "init");

        GitCommandService svc = service(properties);
        svc.createBranch(1L, "feature/test", "main");
        Path featureWt = worktreeManager(properties).findExistingWorktree(1L, "feature/test").orElseThrow();
        write(featureWt, "_flows/example/flow.yaml", "id: committed-on-feature\n");
        git(featureWt, "add", "-A");
        git(featureWt, "commit", "-m", "feature commit");

        write(repo, "_flows/example/flow.yaml", "id: changed\n");
        write(repo, "_flows/with-layout/.layout.json", "{\"node_1\":{\"x\":1,\"y\":2}}\n");
        write(repo, "_flows/with-parameters/.parameters.json", "{\"groupVersion\":2}\n");
        write(repo, "_flows/with-hive-conf/.hive-conf.json", "{\"schemaVersion\":1}\n");
        write(repo, "scripts/scripted/node_1.sql", "select 2;\n");
        write(repo, "README.md", "changed\n");

        DirtyWorkingTreeException ex = assertThrows(DirtyWorkingTreeException.class,
                () -> svc.mergeBranch(1L, "feature/test", "main"));

        assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(ex.getReason()).isEqualTo("工作区有未提交改动");
        assertThat(ex.details().changedFlows()).containsExactlyInAnyOrder(
                "_flows/example/flow.yaml",
                "_flows/with-layout/flow.yaml",
                "_flows/with-parameters/flow.yaml",
                "_flows/with-hive-conf/flow.yaml",
                "_flows/scripted/flow.yaml"
        );
        assertThat(ex.details().changedFlowDetails())
                .extracting("path", "status")
                .contains(
                        org.assertj.core.groups.Tuple.tuple("_flows/example/flow.yaml", "MODIFIED"),
                        org.assertj.core.groups.Tuple.tuple("_flows/with-layout/flow.yaml", "MODIFIED"),
                        org.assertj.core.groups.Tuple.tuple("_flows/with-parameters/flow.yaml", "MODIFIED"),
                        org.assertj.core.groups.Tuple.tuple("_flows/with-hive-conf/flow.yaml", "MODIFIED"),
                        org.assertj.core.groups.Tuple.tuple("_flows/scripted/flow.yaml", "MODIFIED")
                );
        assertThat(ex.details().otherFileCount()).isEqualTo(1);
    }

    @Test
    void syncFromMain_marksDeletedFlowAsDeletedInDirtySummary() throws Exception {
        OfflineProperties properties = properties();
        Path repo = properties.resolveRepoPath(1L);
        initRepo(repo);
        write(repo, "_flows/deleted/flow.yaml", "id: deleted\n");
        write(repo, "_flows/modified/flow.yaml", "id: modified\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "init");

        GitCommandService svc = service(properties);
        svc.createBranch(1L, "feature/test", "main");
        Path featureWt = worktreeManager(properties).findExistingWorktree(1L, "feature/test").orElseThrow();
        Files.delete(featureWt.resolve("_flows/deleted/flow.yaml"));
        write(featureWt, "_flows/modified/flow.yaml", "id: changed\n");
        write(featureWt, "_flows/added/flow.yaml", "id: added\n");

        DirtyWorkingTreeException ex = assertThrows(DirtyWorkingTreeException.class,
                () -> svc.syncFromMain(1L, "feature/test"));

        assertThat(ex.details().changedFlowDetails())
                .extracting("path", "status")
                .containsExactlyInAnyOrder(
                        org.assertj.core.groups.Tuple.tuple("_flows/deleted/flow.yaml", "DELETED"),
                        org.assertj.core.groups.Tuple.tuple("_flows/modified/flow.yaml", "MODIFIED"),
                        org.assertj.core.groups.Tuple.tuple("_flows/added/flow.yaml", "ADDED")
                );
    }

    @Test
    void createBranch_createsIsolatedWorktreeEvenWhenMainHasUncommittedChanges() throws Exception {
        OfflineProperties properties = properties();
        Path repo = properties.resolveRepoPath(1L);
        initRepo(repo);
        write(repo, "_flows/example/flow.yaml", "id: example\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "init");
        write(repo, "_flows/example/flow.yaml", "id: uncommitted-on-main\n");

        service(properties).createBranch(1L, "feature/test", "main");

        assertThat(git(repo, "branch", "--show-current")).isEqualTo("main");
        Path featureWt = worktreeManager(properties).findExistingWorktree(1L, "feature/test").orElseThrow();
        assertThat(git(featureWt, "branch", "--show-current")).isEqualTo("feature/test");
        assertThat(Files.readString(featureWt.resolve("_flows/example/flow.yaml"))).isEqualTo("id: example\n");
    }

    @Test
    void switchBranch_createsLocalTrackingWorktreeWithoutTouchingMainCheckout() throws Exception {
        OfflineProperties properties = properties();
        Path repo = properties.resolveRepoPath(1L);
        Path remote = tempDir.resolve("remote.git");
        initRepoWithRemote(repo, remote);
        createRemoteOnlyBranch(remote, "feature/remote-only");
        git(repo, "fetch", "origin");

        service(properties).switchBranch(1L, "feature/remote-only");

        assertThat(git(repo, "branch", "--show-current")).isEqualTo("main");
        Path remoteWt = worktreeManager(properties).findExistingWorktree(1L, "feature/remote-only").orElseThrow();
        assertThat(git(remoteWt, "branch", "--show-current")).isEqualTo("feature/remote-only");
        assertThat(git(remoteWt, "rev-parse", "--abbrev-ref", "@{upstream}")).isEqualTo("origin/feature/remote-only");
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
    void mergeBranch_updatesTargetWithoutDisturbingFeatureWorktree() throws Exception {
        OfflineProperties properties = properties();
        Path repo = properties.resolveRepoPath(1L);
        initRepo(repo);
        write(repo, "_flows/example/flow.yaml", "id: example\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "init");

        GitCommandService svc = service(properties);
        svc.createBranch(1L, "feature/my-feature", "main");
        Path featureWt = worktreeManager(properties).findExistingWorktree(1L, "feature/my-feature").orElseThrow();
        write(featureWt, "_flows/example/flow.yaml", "id: changed-in-feature\n");
        git(featureWt, "add", "-A");
        git(featureWt, "commit", "-m", "feature change");

        svc.mergeBranch(1L, "feature/my-feature", "main");

        assertThat(git(featureWt, "branch", "--show-current")).isEqualTo("feature/my-feature");
        assertThat(git(repo, "branch", "--show-current")).isEqualTo("main");
        assertThat(Files.readString(repo.resolve("_flows/example/flow.yaml"))).contains("id: changed-in-feature");
    }

    @Test
    void concurrentWorktreesAllowHotfixMergeToMainAndSyncFromMainWithoutConflict() throws Exception {
        OfflineProperties properties = properties();
        Path repo = properties.resolveRepoPath(1L);
        initRepo(repo);
        write(repo, "_flows/a/flow.yaml", "id: a\n");
        write(repo, "_flows/b/flow.yaml", "id: b\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "init");

        GitCommandService svc = service(properties);
        svc.createBranch(1L, "feature/a", "main");
        svc.createBranch(1L, "hotfix/b", "main");

        Path featureAWt = worktreeManager(properties).findExistingWorktree(1L, "feature/a").orElseThrow();
        Path hotfixBWt = worktreeManager(properties).findExistingWorktree(1L, "hotfix/b").orElseThrow();

        // Developer leaves dirty edit in feature/a while hotfix/b commits & merges into main
        write(featureAWt, "_flows/a/flow.yaml", "id: a-wip-uncommitted\n");
        write(hotfixBWt, "_flows/b/flow.yaml", "id: b-hotfix\n");
        git(hotfixBWt, "add", "-A");
        git(hotfixBWt, "commit", "-m", "hotfix b");

        svc.mergeBranch(1L, "hotfix/b", "main");
        assertThat(Files.readString(repo.resolve("_flows/b/flow.yaml"))).isEqualTo("id: b-hotfix\n");
        assertThat(Files.readString(featureAWt.resolve("_flows/a/flow.yaml"))).isEqualTo("id: a-wip-uncommitted\n");

        // Commit feature/a work and sync latest hotfix from main
        git(featureAWt, "add", "-A");
        git(featureAWt, "commit", "-m", "commit feature a");

        var syncRes = svc.syncFromMain(1L, "feature/a");
        assertThat(syncRes.upToDate()).isFalse();
        assertThat(Files.readString(featureAWt.resolve("_flows/b/flow.yaml"))).isEqualTo("id: b-hotfix\n");
        assertThat(Files.readString(featureAWt.resolve("_flows/a/flow.yaml"))).isEqualTo("id: a-wip-uncommitted\n");

        var secondSync = svc.syncFromMain(1L, "feature/a");
        assertThat(secondSync.upToDate()).isTrue();
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
    void deleteBranch_refusesActiveRequestBranchAndMainAndRemovesDetachedWorktree() throws Exception {
        OfflineProperties properties = properties();
        Path repo = properties.resolveRepoPath(1L);
        initRepo(repo);
        write(repo, "_flows/example/flow.yaml", "id: example\n");
        git(repo, "add", "-A");
        git(repo, "commit", "-m", "init");

        GitCommandService svc = service(properties);
        ResponseStatusException main = assertThrows(ResponseStatusException.class,
                () -> svc.deleteBranch(1L, "main", false));
        assertThat(main.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);

        svc.createBranch(1L, "feature/test", "main");
        Path featureWt = worktreeManager(properties).findExistingWorktree(1L, "feature/test").orElseThrow();
        assertThat(Files.exists(featureWt)).isTrue();

        com.wbdata.offline.config.OfflineBranchContext.withWorkspace(1L, "feature/test", featureWt, () -> {
            ResponseStatusException current = assertThrows(ResponseStatusException.class,
                    () -> svc.deleteBranch(1L, "feature/test", false));
            assertThat(current.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
            assertThat(current.getReason()).contains("当前分支");
        });

        svc.deleteBranch(1L, "feature/test", false);
        assertThat(worktreeManager(properties).findExistingWorktree(1L, "feature/test")).isEmpty();
        assertThat(Files.exists(featureWt)).isFalse();
    }

    private GitWorktreeManager worktreeManager(OfflineProperties properties) {
        return new GitWorktreeManager(
                properties,
                Mockito.mock(OfflineGitRemotePort.class),
                new RepoLockManager()
        );
    }

    private GitCommandService service(OfflineProperties properties) {
        return new GitCommandService(
                properties,
                Mockito.mock(OfflineGitRemotePort.class),
                Mockito.mock(OfflineFlowDocumentService.class),
                Mockito.mock(OfflinePublishHistoryPort.class),
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
        git(remote, "symbolic-ref", "HEAD", "refs/heads/main");
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
