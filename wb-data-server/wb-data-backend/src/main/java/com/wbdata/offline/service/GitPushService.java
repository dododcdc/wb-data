package com.wbdata.offline.service;

import com.wbdata.git.service.GitConfigService;
import com.wbdata.git.service.provider.GitRemoteProvider;
import com.wbdata.offline.config.OfflineProperties;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;

@Service
@RequiredArgsConstructor
public class GitPushService {

    private final OfflineProperties offlineProperties;
    private final GitConfigService gitConfigService;
    private final OfflineFlowDocumentService offlineFlowDocumentService;

    public record PushResult(boolean success, String message, String remoteUrl, boolean remoteCreated, boolean remoteDeleted) {}
    public record CommitResult(boolean success, String message) {}

    /**
     * 提交当前 Flow 关联文件的改动
     */
    public CommitResult commitCurrentFlow(Long groupId, String flowPath, String commitMessage) {
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
        GitRemoteProvider provider = gitConfigService.getProvider(groupId);
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        ensureRepoExists(repoPath);

        String repoName = "wb-data-" + groupId;
        String currentRemote = getCurrentRemote(repoPath);

        // 检测配置是否切换，切换时清理旧 remote
        checkAndClearStaleRemote(repoPath, currentRemote, provider, groupId);

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
            runGit(repoPath, "push", "-u", "origin", "main", "--force");
        } catch (GitException ex) {
            // push 失败，尝试先 pull 再 push
            try {
                runGit(repoPath, "pull", "--rebase", "origin", "main");
                runGit(repoPath, "push", "-u", "origin", "main", "--force");
            } catch (GitException pullEx) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "推送失败，请检查网络和 Token 权限");
            }
        }

        String displayUrl = provider.buildDisplayUrl(repoName);
        return new PushResult(true, "推送成功", displayUrl, remoteCreated, false);
    }

    /**
     * 重建远程仓库（远程仓库已被删除）并推送
     */
    public PushResult rebuild(Long groupId) {
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
        runGit(repoPath, "push", "-u", "origin", "main", "--force");

        String displayUrl = provider.buildDisplayUrl(repoName);
        return new PushResult(true, "推送成功", displayUrl, true, false);
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

    /** 检测旧 remote 是否指向错误的 provider/base_url，错误则清理 */
    private void checkAndClearStaleRemote(Path repoPath, String currentRemote, GitRemoteProvider provider, Long groupId) {
        if (currentRemote == null) {
            return;
        }

        String configVersion = gitConfigService.getConfigVersion(groupId);
        if (configVersion == null) {
            return;
        }

        // 获取本地 remote 对应的 base URL（从 currentRemote 提取）
        String remoteBase = extractBaseUrl(currentRemote);
        String providerBase = extractBaseUrl(provider.buildDisplayUrl("wb-data-0"));

        if (!remoteBase.equalsIgnoreCase(providerBase)) {
            // provider 或 base_url 变了，需要清理旧 remote
            runGit(repoPath, "remote", "remove", "origin");
        }
    }

    private String extractBaseUrl(String remoteUrl) {
        // 从 https://user:token@github.com/owner/repo.git 提取 https://github.com
        if (remoteUrl == null) {
            return "";
        }
        try {
            java.net.URI uri = new java.net.URI(remoteUrl.replaceFirst("@.+@", "@"));
            String host = uri.getHost();
            String scheme = uri.getScheme();
            return scheme + "://" + host;
        } catch (Exception ex) {
            return "";
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
