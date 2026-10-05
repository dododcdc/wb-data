package com.wbdata.offline.service;

import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.dto.BranchListResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.nio.file.Path;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Git 仓库操作的唯一入口：持有仓库锁，分支管理委托 {@link GitBranchOperations}，
 * 脏工作树检测委托 {@link GitWorkingTreeStatus}，本类保留任务级/仓库级提交与推送。
 * 协作类自身不加锁。
 */
@Service
public class GitCommandService extends GitRepositoryOperations {

    private final OfflineGitRemotePort gitRemotePort;
    private final OfflineFlowDocumentService offlineFlowDocumentService;
    private final RepoLockManager repoLockManager;
    private final GitBranchOperations branchOperations;
    private final GitWorkingTreeStatus workingTreeStatus;
    private ApplicationEventPublisher applicationEventPublisher = event -> {};

    public record PushResult(boolean success, String message, String remoteUrl, boolean remoteCreated, boolean remoteDeleted) {}
    public record CommitResult(boolean success, String message) {}

    public GitCommandService(OfflineProperties offlineProperties,
                             OfflineGitRemotePort gitRemotePort,
                             OfflineFlowDocumentService offlineFlowDocumentService,
                             RepoLockManager repoLockManager) {
        super(offlineProperties);
        this.gitRemotePort = gitRemotePort;
        this.offlineFlowDocumentService = offlineFlowDocumentService;
        this.repoLockManager = repoLockManager;
        this.branchOperations = new GitBranchOperations(offlineProperties);
        this.workingTreeStatus = new GitWorkingTreeStatus();
    }

    public BranchListResponse listBranches(Long groupId) {
        return repoLockManager.withLock(groupId, () -> branchOperations.listBranches(groupId));
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
        List<String> trackedFiles = offlineFlowDocumentService.resolveManagedFiles(groupId, flowPath);

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

    private boolean hasFlowChangesUnlocked(Long groupId, String flowPath) {
        Path repoPath = repoPath(groupId);
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
        Path repoPath = repoPath(groupId);
        ensureRepoExists(repoPath);

        String repoName = "wb-data-" + groupId;
        String currentRemote = getCurrentRemote(repoPath);

        // 检测配置是否切换，切换时清理旧 remote
        currentRemote = clearStaleRemote(repoPath, currentRemote, groupId, repoName);

        boolean remoteCreated = false;
        if (currentRemote == null) {
            // 首次推送：创建远程仓库 + 添加 remote
            gitRemotePort.createRepository(groupId, repoName, true);
            String pushUrl = gitRemotePort.buildPushUrl(groupId, repoName);
            runGit(repoPath, "remote", "add", "origin", pushUrl);
            currentRemote = pushUrl;
            remoteCreated = true;
        } else {
            // 已有 remote，检查远程仓库是否仍然存在
            if (!gitRemotePort.repositoryExists(groupId, repoName)) {
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

        String displayUrl = gitRemotePort.buildDisplayUrl(groupId, repoName);
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
        String pushUrl = gitRemotePort.buildPushUrl(groupId, repoName);
        runGit(repoPath, "remote", "add", "origin", pushUrl);

        // git push
        runGit(repoPath, "push", "-u", "origin", "HEAD");

        String displayUrl = gitRemotePort.buildDisplayUrl(groupId, repoName);
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
                && (current.equals(canonicalRemoteUrl(gitRemotePort.buildPushUrl(groupId, repoName)))
                || current.equals(canonicalRemoteUrl(gitRemotePort.buildDisplayUrl(groupId, repoName))));
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
}
