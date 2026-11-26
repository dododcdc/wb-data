package com.wbdata.offline.repo.service;

import com.wbdata.offline.service.OfflineFlowDocumentService;

import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.repo.dto.BranchListResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/**
 * 持有仓库锁的 Git 操作入口：负责任务级/仓库级提交、推送与历史文件读取，
 * 分支管理委托 {@link GitBranchOperations}（协作类自身不加锁）。
 */
@Service
public class GitCommandService extends GitRepositoryOperations {

    private final OfflineGitRemotePort gitRemotePort;
    private final OfflineFlowDocumentService offlineFlowDocumentService;
    private final OfflinePublishHistoryPort publishHistoryPort;
    private final RepoLockManager repoLockManager;
    private final GitBranchOperations branchOperations;
    private ApplicationEventPublisher applicationEventPublisher = event -> {};

    public record PushResult(boolean success, String message, String remoteUrl, boolean remoteCreated, boolean remoteDeleted) {}
    public record CommitResult(boolean success, String message) {}

    public GitCommandService(OfflineProperties offlineProperties,
                             OfflineGitRemotePort gitRemotePort,
                             OfflineFlowDocumentService offlineFlowDocumentService,
                             OfflinePublishHistoryPort publishHistoryPort,
                             RepoLockManager repoLockManager) {
        super(offlineProperties);
        this.gitRemotePort = gitRemotePort;
        this.offlineFlowDocumentService = offlineFlowDocumentService;
        this.publishHistoryPort = publishHistoryPort;
        this.repoLockManager = repoLockManager;
        this.branchOperations = new GitBranchOperations(offlineProperties, gitRemotePort);
    }

    public BranchListResponse listBranches(Long groupId) {
        return repoLockManager.withLock(groupId, () -> branchOperations.listBranches(groupId));
    }

    public List<String> listFlowFilesAtRevision(Long groupId, String revision) {
        validateRevision(revision);
        return repoLockManager.withLock(groupId, () -> runGit(repoPath(groupId),
                        "ls-tree", "-r", "--name-only", revision, "--", ".wb-data/kestra-flows")
                .lines()
                .filter(path -> !path.isBlank())
                .toList());
    }

    /**
     * 单次批量读取指定 Git 提交下的所有 Kestra 发布任务文件内容，避免按文件逐次 fork git 进程。
     */
    public Map<String, String> readFlowFilesAtRevision(Long groupId, String revision) {
        validateRevision(revision);
        return repoLockManager.withLock(groupId, () -> readFlowFilesAtRevisionUnlocked(repoPath(groupId), revision));
    }

    private Map<String, String> readFlowFilesAtRevisionUnlocked(Path repoPath, String revision) {
        byte[] treeOutput = runGitRawStdout(repoPath, "ls-tree", "-r", "-z", revision, "--", ".wb-data/kestra-flows");
        List<GitBlobRef> blobs = parseLsTreeNullSeparated(treeOutput);
        if (blobs.isEmpty()) {
            return Map.of();
        }
        return readBlobsBatch(repoPath, blobs);
    }

    private List<GitBlobRef> parseLsTreeNullSeparated(byte[] output) {
        List<GitBlobRef> refs = new ArrayList<>();
        int start = 0;
        for (int i = 0; i <= output.length; i++) {
            if (i < output.length && output[i] != 0) {
                continue;
            }
            if (i > start) {
                String entry = new String(output, start, i - start, StandardCharsets.UTF_8);
                int tabIndex = entry.indexOf('\t');
                if (tabIndex > 0) {
                    String meta = entry.substring(0, tabIndex);
                    String path = entry.substring(tabIndex + 1);
                    String[] parts = meta.split("\\s+");
                    if (parts.length == 3 && "blob".equals(parts[1]) && path.startsWith(".wb-data/kestra-flows/")) {
                        refs.add(new GitBlobRef(path, parts[2]));
                    }
                }
            }
            start = i + 1;
        }
        return refs;
    }

    private Map<String, String> readBlobsBatch(Path repoPath, List<GitBlobRef> blobs) {
        Process process;
        try {
            process = new ProcessBuilder("git", "-C", repoPath.toString(), "cat-file", "--batch")
                    .start();
        } catch (IOException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Git 命令执行失败: " + ex.getMessage(), ex);
        }

        CompletableFuture<Void> stdinFuture = CompletableFuture.runAsync(() -> {
            try (OutputStream stdin = process.getOutputStream()) {
                for (GitBlobRef blob : blobs) {
                    stdin.write((blob.sha() + "\n").getBytes(StandardCharsets.US_ASCII));
                }
                stdin.flush();
            } catch (IOException ex) {
                throw new IllegalStateException("写入 git cat-file --batch 输入失败", ex);
            }
        });
        CompletableFuture<byte[]> stderrFuture = CompletableFuture.supplyAsync(() -> {
            try (InputStream stderr = process.getErrorStream()) {
                return stderr.readAllBytes();
            } catch (IOException ex) {
                return new byte[0];
            }
        });

        Map<String, String> contents = new LinkedHashMap<>(blobs.size());
        try (BufferedInputStream stdout = new BufferedInputStream(process.getInputStream())) {
            for (GitBlobRef blob : blobs) {
                String header = readAsciiLine(stdout);
                if (header == null) {
                    throw new IllegalStateException("git cat-file --batch 输出提前结束: " + blob.path());
                }
                String[] parts = header.split("\\s+");
                if (parts.length < 3 || "missing".equals(parts[1])) {
                    throw new GitException("Git 提交中缺少对象: " + blob.path() + " (" + blob.sha() + ")");
                }
                int size = Integer.parseInt(parts[2]);
                byte[] bytes = stdout.readNBytes(size);
                if (bytes.length != size) {
                    throw new IllegalStateException("读取 Git 对象内容不完整: " + blob.path());
                }
                int trailingNewline = stdout.read();
                if (trailingNewline != '\n') {
                    throw new IllegalStateException("git cat-file --batch 对象分隔符异常: " + blob.path());
                }
                contents.put(blob.path(), new String(bytes, StandardCharsets.UTF_8));
            }
            if (!process.waitFor(30, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Git 命令执行超时");
            }
            stdinFuture.join();
            byte[] stderr = stderrFuture.join();
            if (process.exitValue() != 0) {
                throw new GitException(sanitizeGitOutput(new String(stderr, StandardCharsets.UTF_8).trim(), Map.of()));
            }
            return Collections.unmodifiableMap(contents);
        } catch (IOException ex) {
            process.destroyForcibly();
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Git 命令执行失败: " + ex.getMessage(), ex);
        } catch (InterruptedException ex) {
            process.destroyForcibly();
            Thread.currentThread().interrupt();
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Git 命令被中断", ex);
        }
    }

    private byte[] runGitRawStdout(Path repoPath, String... args) {
        List<String> command = new ArrayList<>(args.length + 3);
        command.add("git");
        command.add("-C");
        command.add(repoPath.toString());
        command.addAll(List.of(args));
        try {
            Process process = new ProcessBuilder(command).start();
            CompletableFuture<byte[]> stderrFuture = CompletableFuture.supplyAsync(() -> {
                try (InputStream stderr = process.getErrorStream()) {
                    return stderr.readAllBytes();
                } catch (IOException ex) {
                    return new byte[0];
                }
            });
            byte[] stdout;
            try (InputStream in = process.getInputStream()) {
                stdout = in.readAllBytes();
            }
            if (!process.waitFor(30, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Git 命令执行超时");
            }
            byte[] stderr = stderrFuture.join();
            if (process.exitValue() != 0) {
                throw new GitException(sanitizeGitOutput(new String(stderr, StandardCharsets.UTF_8).trim(), Map.of()));
            }
            return stdout;
        } catch (IOException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Git 命令执行失败: " + ex.getMessage(), ex);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Git 命令被中断", ex);
        }
    }

    private String readAsciiLine(BufferedInputStream in) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream(64);
        int b;
        boolean readAny = false;
        while ((b = in.read()) != -1) {
            readAny = true;
            if (b == '\n') {
                break;
            }
            if (b != '\r') {
                buffer.write(b);
            }
        }
        return readAny ? buffer.toString(StandardCharsets.US_ASCII) : null;
    }

    private record GitBlobRef(String path, String sha) {
    }

    public String readFlowFileAtRevision(Long groupId, String revision, String path) {
        if (path == null || !path.startsWith(".wb-data/kestra-flows/")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "任务文件路径不合法");
        }
        return readFileAtRevision(groupId, revision, path);
    }

    public String readFileAtRevision(Long groupId, String revision, String path) {
        validateRevision(revision);
        Path normalized = path == null ? Path.of("") : Path.of(path).normalize();
        if (normalized.isAbsolute() || normalized.toString().contains("..") || normalized.toString().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "仓库文件路径不合法");
        }
        String relativePath = normalized.toString().replace('\\', '/');
        return repoLockManager.withLock(groupId,
                () -> runGit(repoPath(groupId), "show", revision + ":" + relativePath));
    }

    private void validateRevision(String revision) {
        if (revision == null || !revision.matches("[0-9a-fA-F]{40,64}")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Git 提交 SHA 不合法");
        }
    }

    public List<String> listRemoteBranchNames(Long groupId) {
        return repoLockManager.withLock(groupId, () -> branchOperations.listRemoteBranchNames(groupId));
    }

    public String createBranch(Long groupId, String name, String baseBranch) {
        return repoLockManager.withLock(groupId, () -> branchOperations.createBranch(groupId, name, baseBranch));
    }

    public String switchBranch(Long groupId, String branch) {
        return repoLockManager.withLock(groupId, () -> branchOperations.switchBranch(groupId, branch));
    }

    public String mergeBranch(Long groupId, String source, String target) {
        return repoLockManager.withLock(groupId, () -> branchOperations.mergeBranch(groupId, source, target));
    }

    public void deleteBranch(Long groupId, String branch, boolean force) {
        repoLockManager.withLock(groupId, () -> branchOperations.deleteBranch(groupId, branch, force));
    }

    /**
     * 提交当前任务 关联文件的改动
     */
    public CommitResult commitCurrentFlow(Long groupId, String flowPath, String commitMessage) {
        return repoLockManager.withLock(groupId, () -> commitCurrentFlowUnlocked(groupId, flowPath, commitMessage));
    }

    private CommitResult commitCurrentFlowUnlocked(Long groupId, String flowPath, String commitMessage) {
        Path repoPath = repoPath(groupId);
        ensureRepoExists(repoPath);
        List<String> trackedFiles = resolveFlowTrackedFiles(repoPath, groupId, flowPath);

        ensureNoOutOfScopeStagedChanges(repoPath, trackedFiles);

        String scopedStatus = runGitWithPaths(repoPath, List.of("status", "--porcelain"), trackedFiles).trim();
        if (scopedStatus.isEmpty()) {
            return new CommitResult(true, "当前任务 暂无改动需提交");
        }

        runGitWithPaths(repoPath, List.of("add", "-A"), trackedFiles);
        runGitWithPaths(repoPath, List.of("commit", "-m", normalizeCommitMessage(commitMessage)), trackedFiles);
        return new CommitResult(true, "当前任务 版本提交成功");
    }

    public boolean hasFlowChanges(Long groupId, String flowPath) {
        return repoLockManager.withLock(groupId, () -> hasFlowChangesUnlocked(groupId, flowPath));
    }

    public boolean hasUnpushedFlowChanges(Long groupId, String flowPath) {
        return repoLockManager.withLock(groupId, () -> hasUnpushedFlowChangesUnlocked(groupId, flowPath));
    }

    private boolean hasFlowChangesUnlocked(Long groupId, String flowPath) {
        Path repoPath = repoPath(groupId);
        ensureRepoExists(repoPath);
        List<String> trackedFiles = resolveFlowTrackedFiles(repoPath, groupId, flowPath);
        return !runGitWithPaths(repoPath, List.of("status", "--porcelain"), trackedFiles).isBlank();
    }

    private boolean hasUnpushedFlowChangesUnlocked(Long groupId, String flowPath) {
        Path repoPath = repoPath(groupId);
        if (!Files.isDirectory(repoPath.resolve(".git"))) {
            return false;
        }
        String headSha = tryRevParse(repoPath, "HEAD");
        if (headSha == null) {
            return false;
        }
        List<String> flowPathSpecs = resolveFlowPathSpecs(groupId, flowPath);
        String branch = getCurrentBranch(repoPath);
        String originRef = (branch == null || branch.isBlank()) ? null : tryRevParse(repoPath, "refs/remotes/origin/" + branch);
        if (originRef == null) {
            return !runGitWithPaths(
                    repoPath,
                    List.of("-c", "core.quotepath=false", "ls-tree", "-r", "--name-only", "HEAD"),
                    flowPathSpecs
            ).isBlank();
        }
        return !runGitWithPaths(
                repoPath,
                List.of("-c", "core.quotepath=false", "diff", "--no-renames", "--name-only", originRef, headSha),
                flowPathSpecs
        ).isBlank();
    }

    private List<String> resolveFlowPathSpecs(Long groupId, String flowPath) {
        Path normalized = Path.of(flowPath == null ? "" : flowPath).normalize();
        String normalizedValue = normalized.toString().replace('\\', '/');
        if (normalized.isAbsolute()
                || normalizedValue.contains("..")
                || !normalizedValue.startsWith("_flows/")
                || !normalizedValue.endsWith("/flow.yaml")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "任务路径不合法");
        }
        LinkedHashSet<String> specs = new LinkedHashSet<>();
        Path parent = normalized.getParent();
        if (parent != null) {
            String flowDir = parent.toString().replace('\\', '/');
            specs.add(flowDir);
            if (flowDir.length() > "_flows/".length()) {
                specs.add("scripts/" + flowDir.substring("_flows/".length()));
            }
            Path leafName = parent.getFileName();
            if (leafName != null && !leafName.toString().isBlank()) {
                specs.add("transfers/" + leafName);
                specs.add(".wb-data/kestra-flows/" + leafName + ".yaml");
            }
        }
        try {
            specs.addAll(offlineFlowDocumentService.resolveManagedFiles(groupId, flowPath));
        } catch (RuntimeException ignored) {
            // Flow file may not exist on disk if deleted or only present in historical commit.
        }
        return List.copyOf(specs);
    }

    private boolean pathBelongsToFlow(String relativePath, List<String> flowPathSpecs) {
        String normalized = relativePath == null ? "" : relativePath.replace('\\', '/').trim();
        if (normalized.isEmpty()) {
            return false;
        }
        return flowPathSpecs.stream().anyMatch(spec -> normalized.equals(spec) || normalized.startsWith(spec + "/"));
    }

    private List<String> resolveFlowTrackedFiles(Path repoPath, Long groupId, String flowPath) {
        LinkedHashSet<String> tracked = new LinkedHashSet<>(offlineFlowDocumentService.resolveManagedFiles(groupId, flowPath));
        Path parent = Path.of(flowPath).normalize().getParent();
        if (parent != null) {
            String flowDir = parent.toString().replace('\\', '/');
            List<String> lsFilesArgs = new java.util.ArrayList<>(List.of("-c", "core.quotepath=false", "ls-files", "--", flowDir));
            if (flowDir.startsWith("_flows/") && flowDir.length() > "_flows/".length()) {
                lsFilesArgs.add("scripts/" + flowDir.substring("_flows/".length()));
            }
            Path leafName = parent.getFileName();
            if (leafName != null && !leafName.toString().isBlank()) {
                lsFilesArgs.add("transfers/" + leafName);
                lsFilesArgs.add(".wb-data/kestra-flows/" + leafName + ".yaml");
            }
            String trackedFiles = runGit(repoPath, lsFilesArgs.toArray(String[]::new));
            trackedFiles.lines()
                    .map(String::trim)
                    .filter(line -> !line.isEmpty())
                    .forEach(tracked::add);
        }
        return List.copyOf(tracked);
    }

    private String normalizeCommitMessage(String commitMessage) {
        return (commitMessage == null || commitMessage.isBlank())
                ? "update: sync offline changes"
                : commitMessage;
    }

    private void ensureNoOutOfScopeStagedChanges(Path repoPath, List<String> trackedFiles) {
        Set<String> tracked = new LinkedHashSet<>(trackedFiles);
        String staged = runGit(repoPath, "diff", "--cached", "--name-only");
        for (String line : staged.lines().filter(s -> !s.isBlank()).toList()) {
            if (!tracked.contains(line.trim())) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "检测到当前任务 之外的文件已暂存，请先完成仓库级提交");
            }
        }
    }

    private String runGitWithPaths(Path repoPath, List<String> args, List<String> trackedFiles) {
        java.util.ArrayList<String> command = new java.util.ArrayList<>(args);
        command.add("--");
        command.addAll(trackedFiles);
        return runGit(repoPath, command.toArray(String[]::new));
    }

    /**
     * 提交仓库所有改动
     */
    public CommitResult commitRepo(Long groupId, String commitMessage) {
        return repoLockManager.withLock(groupId, () -> commitRepoUnlocked(groupId, commitMessage));
    }

    private CommitResult commitRepoUnlocked(Long groupId, String commitMessage) {
        Path repoPath = repoPath(groupId);
        ensureRepoExists(repoPath);

        String status = runGit(repoPath, "status", "--porcelain").trim();
        if (status.isEmpty()) {
            return new CommitResult(true, "暂无改动需提交");
        }

        runGit(repoPath, "add", "-A");

        String message = (commitMessage == null || commitMessage.isBlank())
                ? "update: sync offline changes"
                : commitMessage;
        runGit(repoPath, "commit", "-m", message);

        return new CommitResult(true, "仓库版本提交成功");
    }

    private record RemoteOriginSetup(String displayUrl, boolean remoteCreated, boolean remoteDeleted) {}

    /**
     * 推送仓库到远程
     * - 检测配置是否切换，切换时清理旧 remote
     * - 自动检测是否需要创建远程仓库
     * - 执行 git push
     */
    public PushResult push(Long groupId, Long pushedBy) {
        return repoLockManager.withLock(groupId, () -> pushUnlocked(groupId, pushedBy));
    }

    /**
     * 仅推送当前任务已提交的改动到远程分支，不带入其他任务尚未推送的提交
     */
    public PushResult pushCurrentFlow(Long groupId, String flowPath, Long pushedBy) {
        return repoLockManager.withLock(groupId, () -> pushCurrentFlowUnlocked(groupId, flowPath, pushedBy));
    }

    private RemoteOriginSetup prepareRemoteOrigin(Path repoPath, Long groupId, String repoName) {
        String displayUrl = gitRemotePort.buildDisplayUrl(groupId, repoName);
        String currentRemote = getCurrentRemote(repoPath);
        currentRemote = clearStaleRemote(repoPath, currentRemote, groupId, repoName);

        boolean remoteCreated = false;
        if (currentRemote == null) {
            gitRemotePort.createRepository(groupId, repoName, true);
            runGit(repoPath, "remote", "add", "origin", displayUrl);
            remoteCreated = true;
        } else {
            if (!gitRemotePort.repositoryExists(groupId, repoName)) {
                return new RemoteOriginSetup(null, false, true);
            }
            if (hasEmbeddedHttpCredentials(currentRemote)) {
                runGit(repoPath, "remote", "set-url", "origin", displayUrl);
            }
        }
        return new RemoteOriginSetup(displayUrl, remoteCreated, false);
    }

    private PushResult pushUnlocked(Long groupId, Long pushedBy) {
        Path repoPath = repoPath(groupId);
        ensureRepoExists(repoPath);

        String repoName = "wb-data-" + groupId;
        RemoteOriginSetup remote = prepareRemoteOrigin(repoPath, groupId, repoName);
        if (remote.remoteDeleted()) {
            return new PushResult(false, "远程仓库已不存在", null, false, true);
        }

        String branch = getCurrentBranch(repoPath);
        String beforeSha = readOriginBranchSha(repoPath, groupId, branch);
        try {
            runRemoteGit(repoPath, gitRemotePort, groupId, "push", "-u", "origin", "HEAD");
        } catch (GitException ex) {
            try {
                runRemoteGit(repoPath, gitRemotePort, groupId, "pull", "--rebase");
                beforeSha = readOriginBranchSha(repoPath, groupId, branch);
                runRemoteGit(repoPath, gitRemotePort, groupId, "push", "-u", "origin", "HEAD");
            } catch (GitException pullEx) {
                abortRebase(repoPath);
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "推送失败，已回滚拉取操作，请检查远程分支冲突或 Token 权限");
            }
        }

        publishPushedEvent(groupId, pushedBy, repoPath, beforeSha);
        return new PushResult(true, "推送成功", remote.displayUrl(), remote.remoteCreated(), false);
    }

    private PushResult pushCurrentFlowUnlocked(Long groupId, String flowPath, Long pushedBy) {
        Path repoPath = repoPath(groupId);
        ensureRepoExists(repoPath);
        List<String> flowPathSpecs = resolveFlowPathSpecs(groupId, flowPath);

        String headSha = tryRevParse(repoPath, "HEAD");
        if (headSha == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "当前任务尚未提交，请先提交当前任务后再推送");
        }

        String repoName = "wb-data-" + groupId;
        RemoteOriginSetup remote = prepareRemoteOrigin(repoPath, groupId, repoName);
        if (remote.remoteDeleted()) {
            return new PushResult(false, "远程仓库已不存在", null, false, true);
        }

        String branch = getCurrentBranch(repoPath);
        String beforeSha = readOriginBranchSha(repoPath, groupId, branch);
        if (beforeSha != null) {
            runRemoteGit(repoPath, gitRemotePort, groupId,
                    "fetch", "origin", "+refs/heads/" + branch + ":refs/remotes/origin/" + branch);
            String fetchedSha = tryRevParse(repoPath, "refs/remotes/origin/" + branch);
            if (fetchedSha != null) {
                beforeSha = fetchedSha;
            }
        }

        List<String> unpushedFlowPaths = beforeSha == null
                ? listPathsInTree(repoPath, headSha, flowPathSpecs)
                : listChangedPathsBetween(repoPath, beforeSha, headSha, flowPathSpecs);
        if (unpushedFlowPaths.isEmpty()) {
            if (hasFlowChangesUnlocked(groupId, flowPath)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "当前任务有未提交的修改，请先提交当前任务后再推送");
            }
            return new PushResult(true, "当前任务已是最新线上状态，无需重复推送", remote.displayUrl(), remote.remoteCreated(), false);
        }

        if (beforeSha == null) {
            List<String> allHeadFiles = listPathsInTree(repoPath, headSha, List.of());
            if (allHeadFiles.stream().allMatch(path -> pathBelongsToFlow(path, flowPathSpecs))) {
                runRemoteGit(repoPath, gitRemotePort, groupId, "push", "-u", "origin", "HEAD");
                publishPushedEvent(groupId, pushedBy, repoPath, null, headSha);
                return new PushResult(true, "当前任务推送成功", remote.displayUrl(), remote.remoteCreated(), false);
            }
        } else if (isAncestor(repoPath, beforeSha, headSha)) {
            List<String> allChangedPaths = listChangedPathsBetween(repoPath, beforeSha, headSha, List.of());
            if (allChangedPaths.stream().allMatch(path -> pathBelongsToFlow(path, flowPathSpecs))) {
                runRemoteGit(repoPath, gitRemotePort, groupId, "push", "-u", "origin", "HEAD");
                publishPushedEvent(groupId, pushedBy, repoPath, beforeSha, headSha);
                return new PushResult(true, "当前任务推送成功", remote.displayUrl(), remote.remoteCreated(), false);
            }
        }

        String baseSha = resolvePushBase(repoPath, beforeSha, headSha, flowPathSpecs);
        List<String> remoteChangedPaths = (beforeSha != null && baseSha != null && !beforeSha.equals(baseSha))
                ? listChangedPathsBetween(repoPath, baseSha, beforeSha, List.of())
                : List.of();
        String pushedCommit = replaySingleFlowCommitsAndRebaseRemainder(
                repoPath, groupId, branch, beforeSha, baseSha, headSha, flowPathSpecs, remoteChangedPaths);
        publishPushedEvent(groupId, pushedBy, repoPath, beforeSha, pushedCommit);
        return new PushResult(true, "当前任务推送成功", remote.displayUrl(), remote.remoteCreated(), false);
    }

    private String resolvePushBase(Path repoPath, String beforeSha, String headSha, List<String> flowPathSpecs) {
        if (beforeSha == null) {
            return null;
        }
        if (isAncestor(repoPath, beforeSha, headSha)) {
            return beforeSha;
        }
        String baseSha = tryMergeBase(repoPath, beforeSha, headSha);
        if (baseSha == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "远端分支与本地分支无共同祖先，请先同步仓库");
        }
        List<String> remoteChangedPaths = listChangedPathsBetween(repoPath, baseSha, beforeSha, List.of());
        if (!remoteChangedPaths.isEmpty()) {
            Set<String> localAndWorktree = new LinkedHashSet<>(listChangedPathsBetween(repoPath, baseSha, headSha, List.of()));
            localAndWorktree.addAll(listWorkingTreePaths(repoPath));
            for (String remotePath : remoteChangedPaths) {
                if (pathBelongsToFlow(remotePath, flowPathSpecs)) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "远端分支上当前任务已有新提交，请先同步后再推送");
                }
                if (localAndWorktree.contains(remotePath)) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "远端分支存在未同步的冲突改动，请先同步仓库后再推送");
                }
            }
        }
        return baseSha;
    }

    private String replaySingleFlowCommitsAndRebaseRemainder(Path repoPath,
                                                             Long groupId,
                                                             String branch,
                                                             String beforeSha,
                                                             String baseSha,
                                                             String headSha,
                                                             List<String> flowPathSpecs,
                                                             List<String> remoteChangedPaths) {
        Path tempIndex;
        try {
            tempIndex = Files.createTempFile("wb-data-flow-push-", ".index");
            Files.deleteIfExists(tempIndex);
        } catch (IOException ex) {
            throw new IllegalStateException("创建临时 Git 索引失败", ex);
        }

        try {
            Map<String, String> indexEnv = Map.of("GIT_INDEX_FILE", tempIndex.toString());
            if (beforeSha != null) {
                runGitWithEnv(repoPath, indexEnv, "read-tree", beforeSha);
            } else {
                runGitWithEnv(repoPath, indexEnv, "read-tree", "--empty");
            }

            String range = baseSha == null ? headSha : baseSha + ".." + headSha;
            List<String> commits = runGit(repoPath, "rev-list", "--reverse", range).lines()
                    .map(String::trim)
                    .filter(s -> !s.isEmpty())
                    .toList();

            String currentCommit = beforeSha;
            String currentTree = beforeSha == null
                    ? runGitWithEnv(repoPath, indexEnv, "write-tree")
                    : runGit(repoPath, "rev-parse", beforeSha + "^{tree}");

            for (String commitSha : commits) {
                List<String> matchingPaths = listCommitChangedPaths(repoPath, commitSha).stream()
                        .filter(path -> pathBelongsToFlow(path, flowPathSpecs))
                        .toList();
                if (matchingPaths.isEmpty()) {
                    continue;
                }
                applyPathsFromCommitToIndex(repoPath, indexEnv, commitSha, matchingPaths);
                String nextTree = runGitWithEnv(repoPath, indexEnv, "write-tree");
                if (!nextTree.equals(currentTree)) {
                    currentCommit = createCommitFromMetadata(repoPath, commitSha, nextTree, currentCommit);
                    currentTree = nextTree;
                }
            }

            String pushedCommit = currentCommit;
            if (pushedCommit == null) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "当前任务暂无可推送改动");
            }
            runRemoteGit(repoPath, gitRemotePort, groupId, "push", "origin", pushedCommit + ":refs/heads/" + branch);
            runGit(repoPath, "update-ref", "refs/remotes/origin/" + branch, pushedCommit);
            runGit(repoPath, "config", "branch." + branch + ".remote", "origin");
            runGit(repoPath, "config", "branch." + branch + ".merge", "refs/heads/" + branch);

            for (String commitSha : commits) {
                List<String> otherPaths = listCommitChangedPaths(repoPath, commitSha).stream()
                        .filter(path -> !pathBelongsToFlow(path, flowPathSpecs))
                        .toList();
                if (otherPaths.isEmpty()) {
                    continue;
                }
                applyPathsFromCommitToIndex(repoPath, indexEnv, commitSha, otherPaths);
                String nextTree = runGitWithEnv(repoPath, indexEnv, "write-tree");
                if (!nextTree.equals(currentTree)) {
                    currentCommit = createCommitFromMetadata(repoPath, commitSha, nextTree, currentCommit);
                    currentTree = nextTree;
                }
            }

            runGit(repoPath, "update-ref", "HEAD", currentCommit, headSha);
            if (!remoteChangedPaths.isEmpty()) {
                runGitWithPaths(repoPath, List.of("checkout", currentCommit), remoteChangedPaths);
            }
            return pushedCommit;
        } finally {
            try {
                Files.deleteIfExists(tempIndex);
            } catch (IOException ignored) {
                // Best-effort temp index cleanup.
            }
        }
    }

    private List<String> listPathsInTree(Path repoPath, String revision, List<String> pathSpecs) {
        List<String> args = List.of("-c", "core.quotepath=false", "ls-tree", "-r", "--name-only", revision);
        String output = pathSpecs.isEmpty()
                ? runGit(repoPath, args.toArray(String[]::new))
                : runGitWithPaths(repoPath, args, pathSpecs);
        return output.lines().map(String::trim).filter(s -> !s.isEmpty()).toList();
    }

    private List<String> listChangedPathsBetween(Path repoPath, String fromRev, String toRev, List<String> pathSpecs) {
        List<String> args = List.of("-c", "core.quotepath=false", "diff", "--no-renames", "--name-only", fromRev, toRev);
        String output = pathSpecs.isEmpty()
                ? runGit(repoPath, args.toArray(String[]::new))
                : runGitWithPaths(repoPath, args, pathSpecs);
        return output.lines().map(String::trim).filter(s -> !s.isEmpty()).toList();
    }

    private List<String> listCommitChangedPaths(Path repoPath, String commitSha) {
        String output = runGit(
                repoPath,
                "-c", "core.quotepath=false",
                "diff-tree", "-m", "--first-parent", "--no-renames", "--no-commit-id", "--name-only", "-r", "--root",
                commitSha
        );
        return output.lines().map(String::trim).filter(s -> !s.isEmpty()).distinct().toList();
    }

    private List<String> listWorkingTreePaths(Path repoPath) {
        String status = runGit(repoPath, "-c", "core.quotepath=false", "status", "--porcelain", "-uall");
        LinkedHashSet<String> paths = new LinkedHashSet<>();
        for (String line : status.lines().toList()) {
            if (line.length() <= 3) {
                continue;
            }
            String entry = line.substring(3).trim();
            int renameArrow = entry.indexOf(" -> ");
            if (renameArrow >= 0) {
                paths.add(entry.substring(0, renameArrow).trim());
                paths.add(entry.substring(renameArrow + 4).trim());
            } else {
                paths.add(entry);
            }
        }
        return List.copyOf(paths);
    }

    private void applyPathsFromCommitToIndex(Path repoPath,
                                             Map<String, String> indexEnv,
                                             String commitSha,
                                             List<String> paths) {
        if (paths.isEmpty()) {
            return;
        }
        String treeOutput = runGitWithPaths(
                repoPath,
                List.of("-c", "core.quotepath=false", "ls-tree", "-r", commitSha),
                paths
        );
        Set<String> presentPaths = new LinkedHashSet<>();
        StringBuilder indexInfo = new StringBuilder();
        for (String line : treeOutput.lines().toList()) {
            if (line.isBlank()) {
                continue;
            }
            int tabIdx = line.indexOf('\t');
            if (tabIdx < 0) {
                continue;
            }
            String meta = line.substring(0, tabIdx);
            String filePath = line.substring(tabIdx + 1);
            String[] parts = meta.trim().split("\\s+");
            if (parts.length < 3 || !"blob".equals(parts[1])) {
                continue;
            }
            presentPaths.add(filePath);
            indexInfo.append(parts[0]).append(' ').append(parts[1]).append(' ').append(parts[2])
                    .append('\t').append(filePath).append('\n');
        }
        if (indexInfo.length() > 0) {
            runGitWithEnvAndInput(repoPath, indexEnv, indexInfo.toString(), "update-index", "--index-info");
        }
        List<String> deletedPaths = paths.stream()
                .filter(path -> !presentPaths.contains(path))
                .toList();
        if (!deletedPaths.isEmpty()) {
            List<String> rmCmd = new ArrayList<>(List.of("update-index", "--force-remove", "--"));
            rmCmd.addAll(deletedPaths);
            runGitWithEnv(repoPath, indexEnv, rmCmd.toArray(String[]::new));
        }
    }

    private String createCommitFromMetadata(Path repoPath, String sourceCommitSha, String treeSha, String parentCommitSha) {
        String meta = runGit(repoPath, "log", "-1", "--format=%an%x1f%ae%x1f%aI%x1f%cn%x1f%ce%x1f%cI", sourceCommitSha);
        String[] parts = meta.split("\u001f", 6);
        String message = runGit(repoPath, "log", "-1", "--format=%B", sourceCommitSha);
        if (message.isBlank()) {
            message = "update: sync offline changes";
        }
        Map<String, String> env = new java.util.LinkedHashMap<>();
        if (parts.length == 6) {
            env.put("GIT_AUTHOR_NAME", parts[0]);
            env.put("GIT_AUTHOR_EMAIL", parts[1]);
            env.put("GIT_AUTHOR_DATE", parts[2]);
            env.put("GIT_COMMITTER_NAME", parts[3]);
            env.put("GIT_COMMITTER_EMAIL", parts[4]);
            env.put("GIT_COMMITTER_DATE", parts[5]);
        }
        if (parentCommitSha == null || parentCommitSha.isBlank()) {
            return runGitWithEnvAndInput(repoPath, env, message + "\n", "commit-tree", treeSha, "-F", "-");
        }
        return runGitWithEnvAndInput(repoPath, env, message + "\n", "commit-tree", treeSha, "-p", parentCommitSha, "-F", "-");
    }

    private String tryRevParse(Path repoPath, String ref) {
        try {
            String value = runGit(repoPath, "rev-parse", "--verify", ref);
            return value.isBlank() ? null : value;
        } catch (GitException ex) {
            return null;
        }
    }

    private boolean isAncestor(Path repoPath, String ancestor, String descendant) {
        try {
            runGit(repoPath, "merge-base", "--is-ancestor", ancestor, descendant);
            return true;
        } catch (GitException ex) {
            return false;
        }
    }

    private String tryMergeBase(Path repoPath, String left, String right) {
        try {
            String base = runGit(repoPath, "merge-base", left, right);
            return base.isBlank() ? null : base;
        } catch (GitException ex) {
            return null;
        }
    }

    /**
     * 重建远程仓库（远程仓库已被删除）并推送
     */
    public PushResult rebuild(Long groupId, Long pushedBy) {
        return repoLockManager.withLock(groupId, () -> rebuildUnlocked(groupId, pushedBy));
    }

    private PushResult rebuildUnlocked(Long groupId, Long pushedBy) {
        Path repoPath = repoPath(groupId);
        ensureRepoExists(repoPath);

        String repoName = "wb-data-" + groupId;

        // 清理旧 remote
        String currentRemote = getCurrentRemote(repoPath);
        if (currentRemote != null) {
            runGit(repoPath, "remote", "remove", "origin");
        }

        // 重建远程仓库
        gitRemotePort.createRepository(groupId, repoName, true);
        String displayUrl = gitRemotePort.buildDisplayUrl(groupId, repoName);
        runGit(repoPath, "remote", "add", "origin", displayUrl);

        // git push
        runRemoteGit(repoPath, gitRemotePort, groupId, "push", "-u", "origin", "HEAD");

        publishPushedEvent(groupId, pushedBy, repoPath, null);
        return new PushResult(true, "推送成功", displayUrl, true, false);
    }

    @Autowired
    public void setApplicationEventPublisher(ApplicationEventPublisher applicationEventPublisher) {
        this.applicationEventPublisher = applicationEventPublisher == null ? event -> {} : applicationEventPublisher;
    }

    public String readRemoteBranchSha(Long groupId, String branch) {
        return repoLockManager.withLock(groupId,
                () -> readOriginBranchSha(repoPath(groupId), groupId, branch));
    }

    private String readOriginBranchSha(Path repoPath, Long groupId, String branch) {
        if (branch == null || branch.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "当前分支不能为空");
        }
        try {
            String output = runRemoteGit(repoPath, gitRemotePort, groupId,
                    "ls-remote", "--heads", "origin", "refs/heads/" + branch);
            if (output.isBlank()) {
                return null;
            }
            return output.lines().findFirst()
                    .map(line -> line.split("\\s+")[0])
                    .orElse(null);
        } catch (GitException ex) {
            return null;
        }
    }

    private void publishPushedEvent(Long groupId, Long pushedBy, Path repoPath, String beforeSha) {
        publishPushedEvent(groupId, pushedBy, repoPath, beforeSha, runGit(repoPath, "rev-parse", "HEAD"));
    }

    private void publishPushedEvent(Long groupId, Long pushedBy, Path repoPath, String beforeSha, String afterSha) {
        String branch = getCurrentBranch(repoPath);
        String remoteAfterSha = readOriginBranchSha(repoPath, groupId, branch);
        if (!afterSha.equals(remoteAfterSha)) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "推送后远端分支校验失败，发布记录未写入");
        }
        Long publishRecordId;
        try {
            publishRecordId = publishHistoryPort.recordPush(groupId, pushedBy, branch, beforeSha, afterSha);
        } catch (RuntimeException ex) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR,
                    "推送已成功，但发布记录写入失败，请稍后通过版本历史对账", ex);
        }
        applicationEventPublisher.publishEvent(
                new GitRepoPushedEvent(publishRecordId, groupId, branch, beforeSha, afterSha));
    }

    /** 获取当前 remote URL（不含 token） */
    public String getRemoteUrl(Long groupId) {
        if (!gitRemotePort.isConfigured(groupId)) {
            return null;
        }
        Path repoPath = repoPath(groupId);
        String remote = getCurrentRemote(repoPath);
        if (remote == null) {
            return null;
        }
        return gitRemotePort.buildDisplayUrl(groupId, "wb-data-" + groupId);
    }

    /** 是否已关联远程仓库 */
    public boolean hasRemote(Long groupId) {
        Path repoPath = repoPath(groupId);
        return getCurrentRemote(repoPath) != null;
    }

    /** 检测旧 remote 是否指向当前 provider/base_url/owner，错误则清理 */
    private String clearStaleRemote(Path repoPath, String currentRemote, Long groupId, String repoName) {
        if (currentRemote == null) {
            return null;
        }

        if (!isConfiguredRemote(currentRemote, groupId, repoName)) {
            runGit(repoPath, "remote", "remove", "origin");
            return null;
        }
        return currentRemote;
    }

    private boolean isConfiguredRemote(String currentRemote, Long groupId, String repoName) {
        String current = canonicalRemoteUrl(currentRemote);
        return !current.isBlank()
                && current.equals(canonicalRemoteUrl(gitRemotePort.buildDisplayUrl(groupId, repoName)));
    }

    private String canonicalRemoteUrl(String remoteUrl) {
        if (remoteUrl == null || remoteUrl.isBlank()) {
            return "";
        }
        try {
            java.net.URI uri = new java.net.URI(stripCredentials(remoteUrl.trim()));
            String scheme = uri.getScheme();
            if (scheme == null || scheme.isBlank()) {
                return remoteUrl.trim();
            }
            String path = uri.getPath() == null ? "" : uri.getPath().replaceAll("/+$", "");
            if (path.endsWith(".git")) {
                path = path.substring(0, path.length() - 4);
            }
            String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();
            int port = uri.getPort();
            if ("file".equalsIgnoreCase(scheme)) {
                return "file:" + path;
            }
            return scheme.toLowerCase() + "://" + host + (port >= 0 ? ":" + port : "") + path;
        } catch (Exception ex) {
            return remoteUrl.trim();
        }
    }

    private void abortRebase(Path repoPath) {
        try {
            runGit(repoPath, "rebase", "--abort");
        } catch (GitException ignored) {
            // Pull may fail before a rebase starts; in that case there is nothing to abort.
        }
    }
}
