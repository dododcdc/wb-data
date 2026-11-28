package com.wbdata.offline.repo.service;

import com.wbdata.offline.config.OfflineBranchContext;
import com.wbdata.offline.config.OfflineProperties;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.lang.Nullable;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;

/**
 * 按分支隔离的 Git worktree 生命周期管理器。
 * 主仓 {@code wb-data-{groupId}} 保持唯一 `.git` 对象库与存量默认分支工作目录；
 * 其他并发分支按需挂载在同级 {@code wb-data-{groupId}-worktrees/<slug>-<hash>} 下，实现同组多分枝并发隔离开发。
 */
@Slf4j
@Service
public class GitWorktreeManager extends GitRepositoryOperations {

    public record WorktreeInfo(String branch, Path path, boolean primary) {
    }

    private final OfflineGitRemotePort gitRemotePort;
    private final RepoLockManager repoLockManager;

    public GitWorktreeManager(OfflineProperties offlineProperties,
                              OfflineGitRemotePort gitRemotePort,
                              RepoLockManager repoLockManager) {
        super(offlineProperties);
        this.gitRemotePort = gitRemotePort;
        this.repoLockManager = repoLockManager;
    }

    public List<WorktreeInfo> listActiveWorktrees(Long groupId) {
        if (groupId == null) {
            return List.of();
        }
        Path primaryRepo = primaryRepoPath(groupId);
        if (!OfflineProperties.isGitRepoInitialized(primaryRepo)) {
            return List.of();
        }
        String output;
        try {
            output = runGit(primaryRepo, "worktree", "list", "--porcelain");
        } catch (GitException ex) {
            log.warn("读取 Git worktree 列表失败: groupId={}, reason={}", groupId, ex.getMessage());
            return List.of();
        }
        return parseWorktreeList(output, primaryRepo);
    }

    public Optional<Path> findExistingWorktree(Long groupId, @Nullable String branch) {
        if (groupId == null || branch == null || branch.isBlank()) {
            return Optional.empty();
        }
        String normalized = branch.trim();
        return listActiveWorktrees(groupId).stream()
                .filter(info -> normalized.equals(info.branch()))
                .map(WorktreeInfo::path)
                .findFirst();
    }

    public Path resolveOrCreateWorktree(Long groupId, String branch) {
        if (branch == null || branch.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "分支名称不能为空");
        }
        String normalizedBranch = branch.trim();
        Optional<Path> fastPath = findExistingWorktree(groupId, normalizedBranch);
        if (fastPath.isPresent()) {
            return fastPath.get();
        }

        return repoLockManager.withLock(groupId, () -> {
            Path primaryRepo = primaryRepoPath(groupId);
            ensureRepoExists(primaryRepo);
            validateBranchName(primaryRepo, normalizedBranch);

            Optional<Path> existing = findExistingWorktree(groupId, normalizedBranch);
            if (existing.isPresent()) {
                return existing.get();
            }

            pruneStaleWorktrees(primaryRepo);

            Path worktreeDir = worktreeDirForBranch(groupId, normalizedBranch);
            try {
                Files.createDirectories(worktreeDir.getParent());
            } catch (IOException ex) {
                throw new IllegalStateException("创建分支工作区目录失败: " + worktreeDir, ex);
            }

            if (localBranchExists(primaryRepo, normalizedBranch)) {
                runGit(primaryRepo, "worktree", "add", worktreeDir.toString(), normalizedBranch);
                return worktreeDir;
            }

            if (getCurrentRemote(primaryRepo) != null) {
                try {
                    runRemoteGit(primaryRepo, gitRemotePort, groupId,
                            "fetch", "origin", normalizedBranch + ":refs/remotes/origin/" + normalizedBranch);
                } catch (GitException ex) {
                    if (!remoteBranchExists(primaryRepo, normalizedBranch)) {
                        throw ex;
                    }
                }
            }

            if (remoteBranchExists(primaryRepo, normalizedBranch)) {
                runGit(primaryRepo, "worktree", "add", "--track", "-b", normalizedBranch,
                        worktreeDir.toString(), "origin/" + normalizedBranch);
                return worktreeDir;
            }

            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "分支不存在: " + normalizedBranch);
        });
    }

    /**
     * 在独立 worktree 中从指定基础分支创建新分支；调用方需已持有 {@code repoLockManager.withLock(groupId)}。
     */
    public Path createBranchWorktree(Long groupId, String newBranch, String baseBranch) {
        Path primaryRepo = primaryRepoPath(groupId);
        ensureRepoExists(primaryRepo);
        validateBranchName(primaryRepo, newBranch);
        validateBranchName(primaryRepo, baseBranch);

        if (localBranchExists(primaryRepo, newBranch)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "分支已存在: " + newBranch);
        }

        String baseRef = resolveBaseRef(primaryRepo, groupId, baseBranch);
        pruneStaleWorktrees(primaryRepo);
        Path worktreeDir = worktreeDirForBranch(groupId, newBranch);
        try {
            Files.createDirectories(worktreeDir.getParent());
        } catch (IOException ex) {
            throw new IllegalStateException("创建分支工作区目录失败: " + worktreeDir, ex);
        }
        runGit(primaryRepo, "worktree", "add", "-b", newBranch, worktreeDir.toString(), baseRef);
        return worktreeDir;
    }

    /**
     * 卸载指定分支的 worktree；若该分支恰在主仓检出，则在清理前校验工作区干净状态并切离该分支。
     */
    public void removeBranchWorktree(Long groupId,
                                     String branch,
                                     boolean force,
                                     GitWorkingTreeStatus workingTreeStatus) {
        Optional<WorktreeInfo> existing = listActiveWorktrees(groupId).stream()
                .filter(info -> branch.equals(info.branch()))
                .findFirst();
        if (existing.isEmpty()) {
            return;
        }
        WorktreeInfo target = existing.get();
        Path primaryRepo = primaryRepoPath(groupId);
        if (!force) {
            String status = runGit(target.path(), "status", "--porcelain");
            workingTreeStatus.ensureClean(status);
        }

        if (!target.primary()) {
            if (force) {
                runGit(primaryRepo, "worktree", "remove", "--force", target.path().toString());
            } else {
                runGit(primaryRepo, "worktree", "remove", target.path().toString());
            }
            pruneStaleWorktrees(primaryRepo);
            return;
        }

        // 若目标分支恰在主仓检出，先尝试切回 main（前提 main 未在其他 worktree 检出），否则切到分离头指针
        boolean mainOccupiedElsewhere = listActiveWorktrees(groupId).stream()
                .anyMatch(info -> !info.primary() && OfflineBranchContext.MAIN_BRANCH.equals(info.branch()));
        if (!mainOccupiedElsewhere
                && !OfflineBranchContext.MAIN_BRANCH.equals(branch)
                && localBranchExists(primaryRepo, OfflineBranchContext.MAIN_BRANCH)) {
            runGit(primaryRepo, force ? "switch" : "switch", OfflineBranchContext.MAIN_BRANCH);
        } else {
            if (force) {
                runGit(primaryRepo, "checkout", "--force", "--detach", "HEAD");
            } else {
                runGit(primaryRepo, "checkout", "--detach", "HEAD");
            }
        }
    }

    Path worktreeDirForBranch(Long groupId, String branch) {
        String slug = sanitizeSlug(branch);
        String hash = sha256Prefix(branch);
        return offlineProperties.resolveWorktreesBaseDir(groupId).resolve(slug + "-" + hash);
    }

    private String resolveBaseRef(Path primaryRepo, Long groupId, String baseBranch) {
        if (localBranchExists(primaryRepo, baseBranch)) {
            return "refs/heads/" + baseBranch;
        }
        if (getCurrentRemote(primaryRepo) != null) {
            try {
                runRemoteGit(primaryRepo, gitRemotePort, groupId,
                        "fetch", "origin", baseBranch + ":refs/remotes/origin/" + baseBranch);
            } catch (GitException ignored) {
                // Fall back to already cached remote tracking ref if present
            }
        }
        if (remoteBranchExists(primaryRepo, baseBranch)) {
            return "refs/remotes/origin/" + baseBranch;
        }
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "基础分支不存在: " + baseBranch);
    }

    private List<WorktreeInfo> parseWorktreeList(String porcelainOutput, Path primaryRepo) {
        if (porcelainOutput == null || porcelainOutput.isBlank()) {
            return List.of();
        }
        Path normalizedPrimary = primaryRepo.toAbsolutePath().normalize();
        List<WorktreeInfo> result = new ArrayList<>();
        Path currentPath = null;
        String currentBranch = null;

        String[] lines = porcelainOutput.split("\\R");
        for (int i = 0; i <= lines.length; i++) {
            String line = i < lines.length ? lines[i].trim() : "";
            if (line.isEmpty()) {
                if (currentPath != null && currentBranch != null && Files.isDirectory(currentPath)) {
                    Path normalizedPath = currentPath.toAbsolutePath().normalize();
                    result.add(new WorktreeInfo(currentBranch, normalizedPath, normalizedPath.equals(normalizedPrimary)));
                }
                currentPath = null;
                currentBranch = null;
                continue;
            }
            if (line.startsWith("worktree ")) {
                currentPath = Path.of(line.substring("worktree ".length()).trim());
            } else if (line.startsWith("branch ")) {
                String ref = line.substring("branch ".length()).trim();
                if (ref.startsWith("refs/heads/")) {
                    currentBranch = ref.substring("refs/heads/".length());
                }
            }
        }
        return List.copyOf(result);
    }

    private void pruneStaleWorktrees(Path primaryRepo) {
        try {
            runGit(primaryRepo, "worktree", "prune");
        } catch (GitException ex) {
            log.debug("清理过期 worktree 失败（已忽略）: {}", ex.getMessage());
        }
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

    private static String sanitizeSlug(String branch) {
        String replaced = branch.replaceAll("[^a-zA-Z0-9._-]", "_")
                .replaceAll("^_+|_+$", "");
        if (replaced.isEmpty()) {
            replaced = "branch";
        }
        return replaced.length() > 48 ? replaced.substring(0, 48) : replaced;
    }

    private static String sha256Prefix(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest).substring(0, 8);
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
    }
}
