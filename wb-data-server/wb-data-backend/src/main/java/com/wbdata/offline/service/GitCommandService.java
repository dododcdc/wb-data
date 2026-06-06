package com.wbdata.offline.service;

import com.wbdata.git.service.GitConfigService;
import com.wbdata.git.service.provider.GitRemoteProvider;
import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.dto.BranchItemResponse;
import com.wbdata.offline.dto.BranchListResponse;
import com.wbdata.offline.dto.DirtyFlowChangeResponse;
import com.wbdata.offline.dto.DirtyWorkingTreeResponse;
import com.wbdata.offline.exception.DirtyWorkingTreeException;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;

@Service
@RequiredArgsConstructor
public class GitCommandService {

    private final OfflineProperties offlineProperties;
    private final GitConfigService gitConfigService;
    private final OfflineFlowDocumentService offlineFlowDocumentService;
    private final RepoLockManager repoLockManager;
    private ApplicationEventPublisher applicationEventPublisher = event -> {};

    public record PushResult(boolean success, String message, String remoteUrl, boolean remoteCreated, boolean remoteDeleted) {}
    public record CommitResult(boolean success, String message) {}

    public BranchListResponse listBranches(Long groupId) {
        return repoLockManager.withLock(groupId, () -> listBranchesUnlocked(groupId));
    }

    private BranchListResponse listBranchesUnlocked(Long groupId) {
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        ensureRepoExists(repoPath);

        String currentBranch = getCurrentBranch(repoPath);
        Map<String, MutableBranch> branches = new LinkedHashMap<>();

        String localOutput = runGit(repoPath, "for-each-ref", "--format=%(refname:short)|%(upstream:short)", "refs/heads");
        for (String line : localOutput.lines().filter(line -> !line.isBlank()).toList()) {
            String[] parts = line.split("\\|", -1);
            String name = parts[0].trim();
            String upstream = parts.length > 1 && !parts[1].isBlank() ? parts[1].trim() : null;
            MutableBranch branch = branches.computeIfAbsent(name, MutableBranch::new);
            branch.local = true;
            branch.current = name.equals(currentBranch);
            branch.trackingBranch = upstream;
        }

        String remoteOutput = runGit(repoPath, "for-each-ref", "--format=%(refname:short)", "refs/remotes/origin");
        for (String remoteName : remoteOutput.lines().map(String::trim).filter(line -> !line.isBlank()).toList()) {
            if ("origin/HEAD".equals(remoteName)) {
                continue;
            }
            String name = stripOrigin(remoteName);
            MutableBranch branch = branches.computeIfAbsent(name, MutableBranch::new);
            branch.remote = true;
            branch.remoteName = remoteName;
        }

        List<BranchItemResponse> items = branches.values().stream()
                .map(MutableBranch::toResponse)
                .toList();
        return new BranchListResponse(items);
    }

    public String createBranch(Long groupId, String name, String baseBranch) {
        return repoLockManager.withLock(groupId, () -> createBranchUnlocked(groupId, name, baseBranch));
    }

    private String createBranchUnlocked(Long groupId, String name, String baseBranch) {
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        ensureRepoExists(repoPath);
        validateBranchName(repoPath, name);
        validateBranchName(repoPath, baseBranch);
        ensureClean(repoPath);

        switchToExistingOrRemote(repoPath, baseBranch);
        runGit(repoPath, "switch", "-c", name);
        return name;
    }

    public String switchBranch(Long groupId, String branch) {
        return repoLockManager.withLock(groupId, () -> switchBranchUnlocked(groupId, branch));
    }

    private String switchBranchUnlocked(Long groupId, String branch) {
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        ensureRepoExists(repoPath);
        validateBranchName(repoPath, branch);
        ensureClean(repoPath);

        switchToExistingOrRemote(repoPath, branch);
        return branch;
    }

    public String mergeBranch(Long groupId, String source, String target) {
        return repoLockManager.withLock(groupId, () -> mergeBranchUnlocked(groupId, source, target));
    }

    private String mergeBranchUnlocked(Long groupId, String source, String target) {
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        ensureRepoExists(repoPath);
        validateBranchName(repoPath, source);
        validateBranchName(repoPath, target);
        ensureClean(repoPath);

        String originalBranch = getCurrentBranch(repoPath);
        String sourceRef = resolveMergeSourceRef(repoPath, source);
        try {
            switchToExistingOrRemote(repoPath, target);
            runGit(repoPath, "merge", sourceRef);
            if (originalBranch != null && !originalBranch.isBlank() && !originalBranch.equals(target)) {
                switchToExistingOrRemote(repoPath, originalBranch);
            }
            return target;
        } catch (GitException ex) {
            try {
                runGit(repoPath, "merge", "--abort");
            } catch (GitException ignored) {
                // No merge in progress or abort already completed.
            }
            if (originalBranch != null && !originalBranch.isBlank()) {
                try {
                    runGit(repoPath, "switch", originalBranch);
                } catch (GitException restoreEx) {
                    throw new ResponseStatusException(HttpStatus.CONFLICT, "合并后恢复分支失败，请手动检查仓库状态");
                }
            }
            throw new ResponseStatusException(HttpStatus.CONFLICT, "合并冲突，请在本地解决后重新推送");
        }
    }

    private String resolveMergeSourceRef(Path repoPath, String source) {
        if (localBranchExists(repoPath, source)) {
            return source;
        }
        try {
            runGit(repoPath, "fetch", "origin", source + ":refs/remotes/origin/" + source);
            return "origin/" + source;
        } catch (GitException ex) {
            if (remoteBranchExists(repoPath, source)) {
                return "origin/" + source;
            }
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "分支不存在: " + source);
        }
    }

    public void deleteBranch(Long groupId, String branch, boolean force) {
        repoLockManager.withLock(groupId, () -> deleteBranchUnlocked(groupId, branch, force));
    }

    private void deleteBranchUnlocked(Long groupId, String branch, boolean force) {
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        ensureRepoExists(repoPath);
        validateBranchName(repoPath, branch);

        String currentBranch = getCurrentBranch(repoPath);
        if (branch.equals(currentBranch)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "不能删除当前分支");
        }
        if ("main".equals(branch)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "不能删除 main 分支");
        }

        runGit(repoPath, "branch", force ? "-D" : "-d", branch);
    }

    /**
     * 提交当前 Flow 关联文件的改动
     */
    public CommitResult commitCurrentFlow(Long groupId, String flowPath, String commitMessage) {
        return repoLockManager.withLock(groupId, () -> commitCurrentFlowUnlocked(groupId, flowPath, commitMessage));
    }

    private CommitResult commitCurrentFlowUnlocked(Long groupId, String flowPath, String commitMessage) {
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        ensureRepoExists(repoPath);
        List<String> trackedFiles = offlineFlowDocumentService.resolveManagedFiles(groupId, flowPath);

        ensureNoOutOfScopeStagedChanges(repoPath, trackedFiles);

        String scopedStatus = runGitWithPaths(repoPath, List.of("status", "--porcelain"), trackedFiles).trim();
        if (scopedStatus.isEmpty()) {
            return new CommitResult(true, "当前 Flow 暂无改动需提交");
        }

        runGitWithPaths(repoPath, List.of("add", "-A"), trackedFiles);
        runGitWithPaths(repoPath, List.of("commit", "-m", normalizeCommitMessage(commitMessage)), trackedFiles);
        return new CommitResult(true, "当前 Flow 版本提交成功");
    }

    public boolean hasFlowChanges(Long groupId, String flowPath) {
        return repoLockManager.withLock(groupId, () -> hasFlowChangesUnlocked(groupId, flowPath));
    }

    private boolean hasFlowChangesUnlocked(Long groupId, String flowPath) {
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        ensureRepoExists(repoPath);
        List<String> trackedFiles = offlineFlowDocumentService.resolveManagedFiles(groupId, flowPath);
        return !runGitWithPaths(repoPath, List.of("status", "--porcelain"), trackedFiles).isBlank();
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
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "检测到当前 Flow 之外的文件已暂存，请先完成仓库级提交");
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
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
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

    /**
     * 推送仓库到远程
     * - 检测配置是否切换，切换时清理旧 remote
     * - 自动检测是否需要创建远程仓库
     * - 执行 git push
     */
    public PushResult push(Long groupId) {
        return repoLockManager.withLock(groupId, () -> pushUnlocked(groupId));
    }

    private PushResult pushUnlocked(Long groupId) {
        GitRemoteProvider provider = gitConfigService.getProvider(groupId);
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        ensureRepoExists(repoPath);

        String repoName = "wb-data-" + groupId;
        String currentRemote = getCurrentRemote(repoPath);

        // 检测配置是否切换，切换时清理旧 remote
        currentRemote = clearStaleRemote(repoPath, currentRemote, provider, repoName);

        boolean remoteCreated = false;
        if (currentRemote == null) {
            // 首次推送：创建远程仓库 + 添加 remote
            provider.createRepository(repoName, true);
            String pushUrl = provider.buildPushUrl(repoName);
            runGit(repoPath, "remote", "add", "origin", pushUrl);
            currentRemote = pushUrl;
            remoteCreated = true;
        } else {
            // 已有 remote，检查远程仓库是否仍然存在
            if (!provider.repositoryExists(repoName)) {
                return new PushResult(false, "远程仓库已不存在", null, false, true);
            }
        }

        // git push
        try {
            runGit(repoPath, "push", "-u", "origin", "HEAD");
        } catch (GitException ex) {
            // push 失败，尝试先 pull 再 push
            try {
                runGit(repoPath, "pull", "--rebase");
                runGit(repoPath, "push", "-u", "origin", "HEAD");
            } catch (GitException pullEx) {
                abortRebase(repoPath);
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "推送失败，已回滚拉取操作，请检查远程分支冲突或 Token 权限");
            }
        }

        String displayUrl = provider.buildDisplayUrl(repoName);
        publishPushedEvent(groupId, repoPath);
        return new PushResult(true, "推送成功", displayUrl, remoteCreated, false);
    }

    /**
     * 重建远程仓库（远程仓库已被删除）并推送
     */
    public PushResult rebuild(Long groupId) {
        return repoLockManager.withLock(groupId, () -> rebuildUnlocked(groupId));
    }

    private PushResult rebuildUnlocked(Long groupId) {
        GitRemoteProvider provider = gitConfigService.getProvider(groupId);
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        ensureRepoExists(repoPath);

        String repoName = "wb-data-" + groupId;

        // 清理旧 remote
        String currentRemote = getCurrentRemote(repoPath);
        if (currentRemote != null) {
            runGit(repoPath, "remote", "remove", "origin");
        }

        // 重建远程仓库
        provider.createRepository(repoName, true);
        String pushUrl = provider.buildPushUrl(repoName);
        runGit(repoPath, "remote", "add", "origin", pushUrl);

        // git push
        runGit(repoPath, "push", "-u", "origin", "HEAD");

        String displayUrl = provider.buildDisplayUrl(repoName);
        publishPushedEvent(groupId, repoPath);
        return new PushResult(true, "推送成功", displayUrl, true, false);
    }

    @Autowired
    public void setApplicationEventPublisher(ApplicationEventPublisher applicationEventPublisher) {
        this.applicationEventPublisher = applicationEventPublisher == null ? event -> {} : applicationEventPublisher;
    }

    private void publishPushedEvent(Long groupId, Path repoPath) {
        applicationEventPublisher.publishEvent(new GitRepoPushedEvent(groupId, getCurrentBranch(repoPath)));
    }

    /** 获取当前 remote URL（不含 token） */
    public String getRemoteUrl(Long groupId) {
        GitRemoteProvider provider = gitConfigService.getProviderIfConfigured(groupId);
        if (provider == null) {
            return null;
        }
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        String remote = getCurrentRemote(repoPath);
        if (remote == null) {
            return null;
        }
        return provider.buildDisplayUrl("wb-data-" + groupId);
    }

    /** 是否已关联远程仓库 */
    public boolean hasRemote(Long groupId) {
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        return getCurrentRemote(repoPath) != null;
    }

    /** 检测旧 remote 是否指向当前 provider/base_url/owner，错误则清理 */
    private String clearStaleRemote(Path repoPath, String currentRemote, GitRemoteProvider provider, String repoName) {
        if (currentRemote == null) {
            return null;
        }

        if (!isConfiguredRemote(currentRemote, provider, repoName)) {
            runGit(repoPath, "remote", "remove", "origin");
            return null;
        }
        return currentRemote;
    }

    private boolean isConfiguredRemote(String currentRemote, GitRemoteProvider provider, String repoName) {
        String current = canonicalRemoteUrl(currentRemote);
        return !current.isBlank()
                && (current.equals(canonicalRemoteUrl(provider.buildPushUrl(repoName)))
                || current.equals(canonicalRemoteUrl(provider.buildDisplayUrl(repoName))));
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

    private String stripCredentials(String remoteUrl) {
        int schemeIndex = remoteUrl.indexOf("://");
        if (schemeIndex < 0) {
            return remoteUrl;
        }
        int authorityStart = schemeIndex + 3;
        int pathStart = remoteUrl.indexOf('/', authorityStart);
        int authorityEnd = pathStart < 0 ? remoteUrl.length() : pathStart;
        int credentialEnd = remoteUrl.lastIndexOf('@', authorityEnd);
        if (credentialEnd < authorityStart) {
            return remoteUrl;
        }
        return remoteUrl.substring(0, authorityStart) + remoteUrl.substring(credentialEnd + 1);
    }

    private void abortRebase(Path repoPath) {
        try {
            runGit(repoPath, "rebase", "--abort");
        } catch (GitException ignored) {
            // Pull may fail before a rebase starts; in that case there is nothing to abort.
        }
    }

    private void ensureRepoExists(Path repoPath) {
        if (!Files.exists(repoPath)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "本地仓库不存在，请先创建项目组");
        }
    }

    private String getCurrentRemote(Path repoPath) {
        try {
            String output = runGit(repoPath, "remote", "-v");
            if (output == null || output.isBlank()) {
                return null;
            }
            String line = output.split("\n")[0];
            String[] parts = line.split("\t");
            if (parts.length < 2) {
                return null;
            }
            return parts[1].split("\\s")[0];
        } catch (GitException ex) {
            return null;
        }
    }

    private String getCurrentBranch(Path repoPath) {
        try {
            return runGit(repoPath, "branch", "--show-current").trim();
        } catch (GitException ex) {
            return null;
        }
    }

    private void validateBranchName(Path repoPath, String branch) {
        if (branch == null || branch.isBlank() || branch.startsWith("-") || branch.startsWith("origin/")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "分支名称不合法");
        }
        try {
            runGit(repoPath, "check-ref-format", "--branch", branch);
        } catch (GitException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "分支名称不合法");
        }
    }

    private void ensureClean(Path repoPath) {
        String status = runGit(repoPath, "status", "--porcelain");
        if (status.isBlank()) {
            return;
        }
        List<GitStatusEntry> changedFiles = status.lines()
                .map(this::parseStatusEntry)
                .filter(entry -> !entry.path().isBlank())
                .toList();
        throw new DirtyWorkingTreeException(summarizeDirtyWorkingTree(changedFiles));
    }

    private DirtyWorkingTreeResponse summarizeDirtyWorkingTree(List<GitStatusEntry> changedFiles) {
        Map<String, String> changedFlows = new LinkedHashMap<>();
        Set<String> rawChangedFiles = new LinkedHashSet<>();
        int otherFileCount = 0;
        for (GitStatusEntry changedFile : changedFiles) {
            rawChangedFiles.add(changedFile.path());
            String flowPath = resolveChangedFlowPath(changedFile);
            if (flowPath == null) {
                otherFileCount++;
            } else {
                changedFlows.merge(flowPath, changedFile.flowStatus(), this::mergeFlowStatus);
            }
        }
        List<String> changedFlowPaths = List.copyOf(changedFlows.keySet());
        List<DirtyFlowChangeResponse> changedFlowDetails = changedFlows.entrySet().stream()
                .map(entry -> new DirtyFlowChangeResponse(entry.getKey(), entry.getValue()))
                .toList();
        return new DirtyWorkingTreeResponse(changedFlowPaths, List.copyOf(rawChangedFiles), otherFileCount, changedFlowDetails);
    }

    private String resolveChangedFlowPath(GitStatusEntry changedFile) {
        if ("ADDED".equals(changedFile.flowStatus())
                && changedFile.path().startsWith("_flows/")
                && changedFile.path().endsWith("/")) {
            return Path.of(changedFile.path()).resolve("flow.yaml").toString();
        }
        return resolveChangedFlowPath(changedFile.path());
    }

    private String resolveChangedFlowPath(String changedFile) {
        Path path = Path.of(changedFile).normalize();
        if (path.isAbsolute() || path.getNameCount() < 2) {
            return null;
        }
        String root = path.getName(0).toString();
        String fileName = path.getFileName().toString();

        if ("_flows".equals(root)) {
            if ("flow.yaml".equals(fileName)) {
                return path.toString();
            }
            if (".layout.json".equals(fileName) && path.getParent() != null) {
                return path.getParent().resolve("flow.yaml").toString();
            }
            return null;
        }

        if ("scripts".equals(root) && path.getNameCount() >= 3 && path.getParent() != null) {
            Path scriptDirectory = path.getParent();
            Path flowDirectory = Path.of("_flows");
            for (int i = 1; i < scriptDirectory.getNameCount(); i++) {
                flowDirectory = flowDirectory.resolve(scriptDirectory.getName(i).toString());
            }
            return flowDirectory.resolve("flow.yaml").toString();
        }
        return null;
    }

    private GitStatusEntry parseStatusEntry(String statusLine) {
        if (statusLine.length() <= 2) {
            return new GitStatusEntry(statusLine.trim(), "MODIFIED");
        }
        String statusCode = statusLine.substring(0, 2);
        String path = statusLine.substring(2).trim();
        int renameArrow = path.indexOf(" -> ");
        String normalizedPath = renameArrow >= 0 ? path.substring(renameArrow + 4).trim() : path;
        return new GitStatusEntry(normalizedPath, resolveFlowStatus(statusCode));
    }

    private String resolveFlowStatus(String statusCode) {
        if (statusCode.indexOf('D') >= 0) {
            return "DELETED";
        }
        if (statusCode.indexOf('A') >= 0 || statusCode.contains("?")) {
            return "ADDED";
        }
        return "MODIFIED";
    }

    private String mergeFlowStatus(String existing, String next) {
        if ("DELETED".equals(existing) || "DELETED".equals(next)) {
            return "DELETED";
        }
        if ("ADDED".equals(existing) || "ADDED".equals(next)) {
            return "ADDED";
        }
        return "MODIFIED";
    }

    private record GitStatusEntry(String path, String flowStatus) {
    }

    private void switchToExistingOrRemote(Path repoPath, String branch) {
        if (localBranchExists(repoPath, branch)) {
            runGit(repoPath, "switch", branch);
            return;
        }
        checkoutRemoteTrackingBranch(repoPath, branch);
    }

    private boolean localBranchExists(Path repoPath, String branch) {
        try {
            runGit(repoPath, "rev-parse", "--verify", "refs/heads/" + branch);
            return true;
        } catch (GitException ex) {
            return false;
        }
    }

    private boolean remoteBranchExists(Path repoPath, String branch) {
        try {
            runGit(repoPath, "rev-parse", "--verify", "refs/remotes/origin/" + branch);
            return true;
        } catch (GitException ex) {
            return false;
        }
    }

    private void checkoutRemoteTrackingBranch(Path repoPath, String branch) {
        runGit(repoPath, "fetch", "origin", branch + ":refs/remotes/origin/" + branch);
        runGit(repoPath, "switch", "--track", "-c", branch, "origin/" + branch);
    }

    private String stripOrigin(String remoteName) {
        return remoteName.startsWith("origin/") ? remoteName.substring("origin/".length()) : remoteName;
    }

    private static final class MutableBranch {
        private final String name;
        private boolean current;
        private boolean local;
        private boolean remote;
        private String remoteName;
        private String trackingBranch;

        private MutableBranch(String name) {
            this.name = name;
        }

        private BranchItemResponse toResponse() {
            return new BranchItemResponse(name, current, local, remote, remoteName, trackingBranch);
        }
    }

    private String runGit(Path repoPath, String... args) {
        List<String> command = new java.util.ArrayList<>();
        command.add("git");
        command.add("-C");
        command.add(repoPath.toString());
        command.addAll(List.of(args));

        try {
            Process process = new ProcessBuilder(command)
                    .redirectErrorStream(true)
                    .start();
            if (!process.waitFor(30, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Git 命令执行超时");
            }
            String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8).trim();
            if (process.exitValue() != 0) {
                throw new GitException(output);
            }
            return output;
        } catch (IOException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Git 命令执行失败: " + ex.getMessage(), ex);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Git 命令被中断", ex);
        }
    }

    private static class GitException extends RuntimeException {
        GitException(String message) {
            super(message);
        }
    }
}
