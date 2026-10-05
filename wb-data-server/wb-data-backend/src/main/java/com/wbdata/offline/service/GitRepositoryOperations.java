package com.wbdata.offline.service;

import com.wbdata.offline.config.OfflineProperties;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * git 进程执行与仓库级原语（存在性检查、当前分支/remote 读取、分支名校验），
 * 供 GitCommandService（提交/推送）与 GitBranchOperations（分支管理）共用。
 */
abstract class GitRepositoryOperations {

    protected final OfflineProperties offlineProperties;

    protected GitRepositoryOperations(OfflineProperties offlineProperties) {
        this.offlineProperties = offlineProperties;
    }

    protected Path repoPath(Long groupId) {
        return offlineProperties.resolveRepoPath(groupId);
    }

    protected void ensureRepoExists(Path repoPath) {
        if (!Files.exists(repoPath)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "本地仓库不存在，请先创建项目组");
        }
    }

    protected String getCurrentRemote(Path repoPath) {
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

    protected String getCurrentBranch(Path repoPath) {
        try {
            return runGit(repoPath, "branch", "--show-current").trim();
        } catch (GitException ex) {
            return null;
        }
    }

    protected void validateBranchName(Path repoPath, String branch) {
        if (branch == null || branch.isBlank() || branch.startsWith("-") || branch.startsWith("origin/")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "分支名称不合法");
        }
        try {
            runGit(repoPath, "check-ref-format", "--branch", branch);
        } catch (GitException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "分支名称不合法");
        }
    }

    protected String runGit(Path repoPath, String... args) {
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

    static class GitException extends RuntimeException {
        GitException(String message) {
            super(message);
        }
    }
}
