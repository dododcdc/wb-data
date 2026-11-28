package com.wbdata.offline.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.nio.file.Files;
import java.nio.file.Path;

@Component
@ConfigurationProperties(prefix = "wbdata.offline")
public class OfflineProperties {

    private String repoBaseDir = "/data/repos";
    private String repoDirPrefix = "wb-data-";

    public String getRepoBaseDir() {
        return repoBaseDir;
    }

    public void setRepoBaseDir(String repoBaseDir) {
        this.repoBaseDir = repoBaseDir;
    }

    public String getRepoDirPrefix() {
        return repoDirPrefix;
    }

    public void setRepoDirPrefix(String repoDirPrefix) {
        this.repoDirPrefix = repoDirPrefix;
    }

    public Path resolveRepoPath(Long groupId) {
        Path contextPath = OfflineBranchContext.currentWorktreePath(groupId);
        if (contextPath != null) {
            return contextPath.toAbsolutePath().normalize();
        }
        return resolvePrimaryRepoPath(groupId);
    }

    public Path resolvePrimaryRepoPath(Long groupId) {
        return Path.of(repoBaseDir, repoDirPrefix + groupId).toAbsolutePath().normalize();
    }

    public Path resolveWorktreesBaseDir(Long groupId) {
        return Path.of(repoBaseDir, repoDirPrefix + groupId + "-worktrees").toAbsolutePath().normalize();
    }

    /**
     * 主仓中 `.git` 为目录，worktree 中 `.git` 为指向主仓 gitdir 的文件；二者均代表已初始化的 Git 工作区。
     */
    public static boolean isGitRepoInitialized(Path repoPath) {
        return repoPath != null && Files.exists(repoPath.resolve(".git"));
    }
}
