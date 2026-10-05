package com.wbdata.offline.service;

import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.dto.BranchItemResponse;
import com.wbdata.offline.dto.BranchListResponse;
import com.wbdata.offline.dto.DirtyFlowChangeResponse;
import com.wbdata.offline.dto.DirtyWorkingTreeResponse;
import com.wbdata.offline.exception.DirtyWorkingTreeException;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 分支管理实现：列表（本地+远程合并）、创建、切换、合并（含冲突回滚）、删除。
 * 方法不带锁；锁由入口 {@link GitCommandService} 在调用处获取。
 */
class GitBranchOperations extends GitRepositoryOperations {

    private final GitWorkingTreeStatus workingTreeStatus = new GitWorkingTreeStatus();

    GitBranchOperations(OfflineProperties offlineProperties) {
        super(offlineProperties);
    }

    private void ensureClean(Path repoPath) {
        workingTreeStatus.ensureClean(runGit(repoPath, "status", "--porcelain"));
    }

    List<String> listRemoteBranchNames(Long groupId) {
        Path repoPath = repoPath(groupId);
        ensureRepoExists(repoPath);
        if (getCurrentRemote(repoPath) == null) {
            return List.of();
        }
        runGit(repoPath, "fetch", "--prune", "origin");
        return runGit(repoPath, "for-each-ref", "--format=%(refname:short)", "--sort=refname", "refs/remotes/origin")
                .lines()
                .map(String::trim)
                .filter(remoteName -> !remoteName.isBlank() && !"origin/HEAD".equals(remoteName))
                .map(this::stripOrigin)
                .toList();
    }

    BranchListResponse listBranches(Long groupId) {
        Path repoPath = repoPath(groupId);
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

    String createBranch(Long groupId, String name, String baseBranch) {
        Path repoPath = repoPath(groupId);
        ensureRepoExists(repoPath);
        validateBranchName(repoPath, name);
        validateBranchName(repoPath, baseBranch);
        ensureClean(repoPath);

        switchToExistingOrRemote(repoPath, baseBranch);
        runGit(repoPath, "switch", "-c", name);
        return name;
    }

    String switchBranch(Long groupId, String branch) {
        Path repoPath = repoPath(groupId);
        ensureRepoExists(repoPath);
        validateBranchName(repoPath, branch);
        ensureClean(repoPath);

        switchToExistingOrRemote(repoPath, branch);
        return branch;
    }

    String mergeBranch(Long groupId, String source, String target) {
        Path repoPath = repoPath(groupId);
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

    String resolveMergeSourceRef(Path repoPath, String source) {
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

    void deleteBranch(Long groupId, String branch, boolean force) {
        Path repoPath = repoPath(groupId);
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
}
