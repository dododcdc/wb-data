package com.wbdata.offline.repo.service;

import com.wbdata.offline.config.OfflineBranchContext;
import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.repo.dto.BranchItemResponse;
import com.wbdata.offline.repo.dto.BranchListResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 分支管理实现：列表（本地+远程合并）、基于 worktree 创建、按需检出切换、合并（含冲突回滚）、从 main 同步与删除。
 * 方法不带锁；锁由入口 {@link GitCommandService} 在调用处获取。
 */
@Slf4j
class GitBranchOperations extends GitRepositoryOperations {

    record MergeResult(String targetBranch, Path worktreePath) {
    }

    record SyncResult(String targetBranch, Path worktreePath, boolean upToDate, String headCommitId) {
    }

    private final GitWorkingTreeStatus workingTreeStatus = new GitWorkingTreeStatus();
    private final OfflineGitRemotePort gitRemotePort;
    private final GitWorktreeManager worktreeManager;

    GitBranchOperations(OfflineProperties offlineProperties,
                        OfflineGitRemotePort gitRemotePort,
                        GitWorktreeManager worktreeManager) {
        super(offlineProperties);
        this.gitRemotePort = gitRemotePort;
        this.worktreeManager = worktreeManager;
    }

    private void ensureClean(Path repoPath) {
        workingTreeStatus.ensureClean(runGit(repoPath, "status", "--porcelain"));
    }

    List<String> listRemoteBranchNames(Long groupId) {
        Path repoPath = primaryRepoPath(groupId);
        ensureRepoExists(repoPath);
        if (getCurrentRemote(repoPath) == null) {
            return List.of();
        }
        try {
            runRemoteGit(repoPath, gitRemotePort, groupId, "fetch", "--prune", "origin");
        } catch (GitException ex) {
            List<String> cached = readCachedRemoteBranchNames(repoPath);
            if (!cached.isEmpty()) {
                log.warn("刷新远程分支失败，降级返回本地已缓存远端分支: groupId={}, message={}", groupId, ex.getMessage());
                return cached;
            }
            throw new ResponseStatusException(
                    HttpStatus.BAD_GATEWAY,
                    "无法连接远程 Git 仓库刷新分支列表，请稍后重试或检查网络与 Token 配置"
            );
        }
        return readCachedRemoteBranchNames(repoPath);
    }

    private List<String> readCachedRemoteBranchNames(Path repoPath) {
        return runGit(repoPath, "for-each-ref", "--format=%(refname:short)", "--sort=refname", "refs/remotes/origin")
                .lines()
                .map(String::trim)
                .filter(remoteName -> !remoteName.isBlank() && !"origin/HEAD".equals(remoteName) && !"origin".equals(remoteName))
                .map(this::stripOrigin)
                .toList();
    }

    BranchListResponse listBranches(Long groupId) {
        Path repoPath = primaryRepoPath(groupId);
        ensureRepoExists(repoPath);

        String activeBranch = OfflineBranchContext.currentBranch(groupId);
        if (activeBranch == null) {
            activeBranch = getCurrentBranch(repoPath);
        }
        Map<String, MutableBranch> branches = new LinkedHashMap<>();

        String localOutput = runGit(repoPath, "for-each-ref", "--format=%(refname:short)|%(upstream:short)", "refs/heads");
        for (String line : localOutput.lines().filter(line -> !line.isBlank()).toList()) {
            String[] parts = line.split("\\|", -1);
            String name = parts[0].trim();
            String upstream = parts.length > 1 && !parts[1].isBlank() ? parts[1].trim() : null;
            MutableBranch branch = branches.computeIfAbsent(name, MutableBranch::new);
            branch.local = true;
            branch.current = name.equals(activeBranch);
            branch.trackingBranch = upstream;
        }

        String remoteOutput = runGit(repoPath, "for-each-ref", "--format=%(refname:short)", "refs/remotes/origin");
        for (String remoteName : remoteOutput.lines().map(String::trim).filter(line -> !line.isBlank()).toList()) {
            if ("origin/HEAD".equals(remoteName) || "origin".equals(remoteName)) {
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

    Path createBranch(Long groupId, String name, String baseBranch) {
        return worktreeManager.createBranchWorktree(groupId, name, baseBranch);
    }

    Path switchBranch(Long groupId, String branch) {
        return worktreeManager.resolveOrCreateWorktree(groupId, branch);
    }

    MergeResult mergeBranch(Long groupId, String source, String target) {
        Path primaryRepo = primaryRepoPath(groupId);
        ensureRepoExists(primaryRepo);
        validateBranchName(primaryRepo, source);
        validateBranchName(primaryRepo, target);

        String sourceRef = resolveMergeSourceRef(primaryRepo, groupId, source);
        Path targetWorktree = worktreeManager.resolveOrCreateWorktree(groupId, target);
        ensureClean(targetWorktree);

        try {
            runGit(targetWorktree, "merge", "--no-edit", sourceRef);
            return new MergeResult(target, targetWorktree);
        } catch (GitException ex) {
            try {
                runGit(targetWorktree, "merge", "--abort");
            } catch (GitException ignored) {
                // No merge in progress or abort already completed.
            }
            throw new ResponseStatusException(HttpStatus.CONFLICT, "合并冲突，请在本地解决后重新推送");
        }
    }

    SyncResult syncFromMain(Long groupId, String targetBranch) {
        if (targetBranch == null || targetBranch.isBlank() || OfflineBranchContext.MAIN_BRANCH.equals(targetBranch.trim())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "当前已在 main 分支，无需同步");
        }
        String normalizedTarget = targetBranch.trim();
        Path primaryRepo = primaryRepoPath(groupId);
        ensureRepoExists(primaryRepo);
        validateBranchName(primaryRepo, normalizedTarget);

        Path targetWorktree = worktreeManager.resolveOrCreateWorktree(groupId, normalizedTarget);
        ensureClean(targetWorktree);

        String mainRef = resolveMainSyncSourceRef(primaryRepo, groupId);
        String beforeHead = tryRevParse(targetWorktree, "HEAD");
        try {
            runGit(targetWorktree, "merge", "--no-edit", mainRef);
        } catch (GitException ex) {
            try {
                runGit(targetWorktree, "merge", "--abort");
            } catch (GitException ignored) {
                // No merge in progress.
            }
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "与 main 分支存在合并冲突，请在远端 Git 平台（PR/MR）或本地解决冲突后重新推送"
            );
        }
        String afterHead = tryRevParse(targetWorktree, "HEAD");
        boolean upToDate = Objects.equals(beforeHead, afterHead);
        return new SyncResult(normalizedTarget, targetWorktree, upToDate, afterHead);
    }

    private String resolveMainSyncSourceRef(Path primaryRepo, Long groupId) {
        if (getCurrentRemote(primaryRepo) != null) {
            try {
                runRemoteGit(primaryRepo, gitRemotePort, groupId,
                        "fetch", "origin", "main:refs/remotes/origin/main");
            } catch (GitException ignored) {
                // Fall back to local/cached refs.
            }
        }
        boolean hasLocalMain = localBranchExists(primaryRepo, OfflineBranchContext.MAIN_BRANCH);
        boolean hasRemoteMain = remoteBranchExists(primaryRepo, OfflineBranchContext.MAIN_BRANCH);
        if (hasLocalMain && hasRemoteMain) {
            String localSha = tryRevParse(primaryRepo, "refs/heads/main");
            String remoteSha = tryRevParse(primaryRepo, "refs/remotes/origin/main");
            if (!Objects.equals(localSha, remoteSha) && isAncestor(primaryRepo, "refs/heads/main", "refs/remotes/origin/main")) {
                return "refs/remotes/origin/main";
            }
            return "refs/heads/main";
        }
        if (hasLocalMain) {
            return "refs/heads/main";
        }
        if (hasRemoteMain) {
            return "refs/remotes/origin/main";
        }
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "未找到 main 分支，无法同步");
    }

    private boolean isAncestor(Path repoPath, String ancestorRef, String descendantRef) {
        try {
            runGit(repoPath, "merge-base", "--is-ancestor", ancestorRef, descendantRef);
            return true;
        } catch (GitException ex) {
            return false;
        }
    }

    private String tryRevParse(Path repoPath, String ref) {
        try {
            return runGit(repoPath, "rev-parse", ref).trim();
        } catch (GitException ex) {
            return null;
        }
    }

    String resolveMergeSourceRef(Path repoPath, Long groupId, String source) {
        if (localBranchExists(repoPath, source)) {
            return source;
        }
        try {
            runRemoteGit(repoPath, gitRemotePort, groupId, "fetch", "origin", source + ":refs/remotes/origin/" + source);
            return "origin/" + source;
        } catch (GitException ex) {
            if (remoteBranchExists(repoPath, source)) {
                return "origin/" + source;
            }
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "分支不存在: " + source);
        }
    }

    void deleteBranch(Long groupId, String branch, boolean force) {
        Path primaryRepo = primaryRepoPath(groupId);
        ensureRepoExists(primaryRepo);
        validateBranchName(primaryRepo, branch);

        String activeBranch = OfflineBranchContext.currentBranch(groupId);
        if (activeBranch == null) {
            activeBranch = getCurrentBranch(primaryRepo);
        }
        if (branch.equals(activeBranch)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "不能删除当前分支");
        }
        if (OfflineBranchContext.MAIN_BRANCH.equals(branch)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "不能删除 main 分支");
        }

        worktreeManager.removeBranchWorktree(groupId, branch, force, workingTreeStatus);
        runGit(primaryRepo, "branch", force ? "-D" : "-d", branch);
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
}
