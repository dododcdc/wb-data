package com.wbdata.offline.service;

import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.dto.OfflineRepoStatusResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.TimeUnit;

@Service
@RequiredArgsConstructor
public class OfflineRepoStatusService {

    private final OfflineProperties offlineProperties;

    public OfflineRepoStatusResponse getRepoStatus(Long groupId) {
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        if (!Files.isDirectory(repoPath)) {
            return new OfflineRepoStatusResponse(
                    groupId,
                    repoPath.toString(),
                    false,
                    false,
                    false,
                    null,
                    null,
                    null,
                    null
            );
        }

        boolean gitInitialized = Files.isDirectory(repoPath.resolve(".git"));
        if (!gitInitialized) {
            return new OfflineRepoStatusResponse(
                    groupId,
                    repoPath.toString(),
                    true,
                    false,
                    false,
                    null,
                    null,
                    null,
                    null
            );
        }

        String headCommitId = tryRunGitCommand(repoPath, "rev-parse", "HEAD");
        String headCommitMessage = headCommitId == null
                ? null
                : runGitCommand(repoPath, "log", "-1", "--pretty=%s");
        Instant headCommitAt = headCommitId == null
                ? null
                : Instant.ofEpochSecond(Long.parseLong(runGitCommand(repoPath, "log", "-1", "--pretty=%ct")));

        return new OfflineRepoStatusResponse(
                groupId,
                repoPath.toString(),
                true,
                true,
                !runGitCommand(repoPath, "status", "--porcelain").isBlank(),
                readBranch(repoPath),
                headCommitId,
                headCommitMessage,
                headCommitAt
        );
    }

    private String runGitCommand(Path repoPath, String... args) {
        List<String> command = new java.util.ArrayList<>();
        command.add("git");
        command.add("-C");
        command.add(repoPath.toString());
        command.addAll(List.of(args));

        try {
            Process process = new ProcessBuilder(command)
                    .redirectErrorStream(true)
                    .start();
            if (!process.waitFor(10, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                throw new IllegalStateException("执行 git 命令超时: " + String.join(" ", command));
            }

            String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8).trim();
            if (process.exitValue() != 0) {
                throw new GitCommandException("执行 git 命令失败: " + output, output);
            }
            return output;
        } catch (IOException ex) {
            throw new IllegalStateException("执行 git 命令失败", ex);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("执行 git 命令被中断", ex);
        }
    }

    private String tryRunGitCommand(Path repoPath, String... args) {
        try {
            return runGitCommand(repoPath, args);
        } catch (GitCommandException ex) {
            if (!isMissingHead(ex.output())) {
                throw ex;
            }
            return null;
        }
    }

    private boolean isMissingHead(String output) {
        return output.contains("unknown revision or path not in the working tree")
                || output.contains("ambiguous argument 'HEAD'")
                || output.contains("Needed a single revision");
    }

    private String readBranch(Path repoPath) {
        String status = runGitCommand(repoPath, "status", "--short", "--branch");
        String firstLine = status.lines().findFirst().orElse("");
        if (firstLine.startsWith("## No commits yet on ")) {
            return firstLine.substring("## No commits yet on ".length()).trim();
        }
        if (firstLine.startsWith("## ")) {
            return firstLine.substring(3).split("\\.\\.\\.")[0].trim();
        }
        return null;
    }

    private static final class GitCommandException extends IllegalStateException {
        private final String output;

        private GitCommandException(String message, String output) {
            super(message);
            this.output = output;
        }

        private String output() {
            return output;
        }
    }
}
