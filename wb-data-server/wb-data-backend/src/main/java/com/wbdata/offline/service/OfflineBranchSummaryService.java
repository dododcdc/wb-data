package com.wbdata.offline.service;

import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.repo.service.RepoLockManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * 只读汇总任意 Git 分支快照的任务规模、调度数量及提交信息，不修改或切换本地工作区。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class OfflineBranchSummaryService {

    private static final int MAX_CACHE_ENTRIES = 1024;
    private static final long GIT_TIMEOUT_SECONDS = 15L;
    private static final long BATCH_TIMEOUT_SECONDS = 30L;

    private final OfflineProperties offlineProperties;
    private final RepoLockManager repoLockManager;
    private final OfflineFlowYamlSupport yamlSupport = new OfflineFlowYamlSupport();
    private final ConcurrentHashMap<String, CachedCommitSummary> commitCache = new ConcurrentHashMap<>();

    public record BranchSnapshotSummary(
            String branch,
            boolean exists,
            String headCommitId,
            String headCommitMessage,
            Instant headCommitAt,
            boolean ahead,
            boolean hasUpstream,
            int flowCount,
            int scheduledFlowCount
    ) {
    }

    private record CachedCommitSummary(
            String headCommitMessage,
            Instant headCommitAt,
            int flowCount,
            int scheduledFlowCount
    ) {
    }

    public List<String> listAvailableBranches(Long groupId) {
        return repoLockManager.withLock(groupId, () -> listAvailableBranchesUnlocked(groupId));
    }

    public BranchSnapshotSummary summarizeBranch(Long groupId, String branch) {
        if (!isValidBranchName(branch)) {
            return notFound(branch);
        }
        String normalizedBranch = branch.trim();
        return repoLockManager.withLock(groupId, () -> summarizeBranchUnlocked(groupId, normalizedBranch));
    }

    private List<String> listAvailableBranchesUnlocked(Long groupId) {
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        if (!isGitRepoInitialized(repoPath)) {
            return List.of();
        }
        Set<String> branches = new LinkedHashSet<>();

        String localOutput = tryRunGit(repoPath, "for-each-ref", "--format=%(refname:short)", "refs/heads");
        if (localOutput != null) {
            localOutput.lines()
                    .map(String::trim)
                    .filter(name -> !name.isBlank())
                    .forEach(branches::add);
        }

        String remoteOutput = tryRunGit(repoPath, "for-each-ref", "--format=%(refname:short)", "refs/remotes/origin");
        if (remoteOutput != null) {
            remoteOutput.lines()
                    .map(String::trim)
                    .filter(name -> !name.isBlank() && !"origin".equals(name) && !"origin/HEAD".equals(name))
                    .map(this::stripOriginPrefix)
                    .filter(name -> !name.isBlank())
                    .forEach(branches::add);
        }

        return List.copyOf(branches);
    }

    private BranchSnapshotSummary summarizeBranchUnlocked(Long groupId, String branch) {
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        if (!isGitRepoInitialized(repoPath)) {
            return notFound(branch);
        }

        String localSha = tryRunGit(repoPath, "rev-parse", "--verify", "--quiet", "refs/heads/" + branch);
        String headCommitId = localSha;
        if (headCommitId == null || headCommitId.isBlank()) {
            headCommitId = tryRunGit(repoPath, "rev-parse", "--verify", "--quiet", "refs/remotes/origin/" + branch);
            localSha = null;
        }
        if (headCommitId == null || headCommitId.isBlank()) {
            return notFound(branch);
        }

        boolean hasUpstream = false;
        boolean ahead = false;
        if (localSha != null) {
            String trackInfo = tryRunGit(
                    repoPath,
                    "for-each-ref",
                    "--format=%(upstream:short)|%(upstream:track)",
                    "refs/heads/" + branch
            );
            if (trackInfo != null && !trackInfo.isBlank()) {
                String[] parts = trackInfo.split("\\|", -1);
                hasUpstream = parts.length > 0 && !parts[0].isBlank();
                ahead = parts.length > 1 && parts[1].contains("[ahead ");
            }
        }

        String cacheKey = groupId + ":" + headCommitId;
        CachedCommitSummary cached = commitCache.get(cacheKey);
        if (cached == null) {
            cached = inspectCommitSummary(repoPath, headCommitId);
            if (commitCache.size() >= MAX_CACHE_ENTRIES) {
                commitCache.clear();
            }
            commitCache.put(cacheKey, cached);
        }

        return new BranchSnapshotSummary(
                branch,
                true,
                headCommitId,
                cached.headCommitMessage(),
                cached.headCommitAt(),
                ahead,
                hasUpstream,
                cached.flowCount(),
                cached.scheduledFlowCount()
        );
    }

    private CachedCommitSummary inspectCommitSummary(Path repoPath, String headCommitId) {
        Instant headCommitAt = null;
        String headCommitMessage = null;
        String commitMeta = tryRunGit(repoPath, "log", "-1", "--pretty=%ct%n%s", headCommitId);
        if (commitMeta != null && !commitMeta.isBlank()) {
            String[] lines = commitMeta.split("\n", 2);
            try {
                headCommitAt = Instant.ofEpochSecond(Long.parseLong(lines[0].trim()));
            } catch (NumberFormatException ignored) {
                headCommitAt = null;
            }
            if (lines.length > 1 && !lines[1].isBlank()) {
                headCommitMessage = lines[1].trim();
            }
        }

        String treeOutput = tryRunGit(
                repoPath,
                "-c",
                "core.quotepath=false",
                "ls-tree",
                "-r",
                "--full-tree",
                headCommitId,
                "--",
                "_flows"
        );
        List<String> blobShas = new ArrayList<>();
        if (treeOutput != null && !treeOutput.isBlank()) {
            for (String line : treeOutput.split("\n")) {
                if (line.isBlank()) {
                    continue;
                }
                int tabIndex = line.indexOf('\t');
                if (tabIndex <= 0) {
                    continue;
                }
                String meta = line.substring(0, tabIndex);
                String path = line.substring(tabIndex + 1);
                String[] parts = meta.split("\\s+");
                if (parts.length < 3 || !"blob".equals(parts[1])) {
                    continue;
                }
                if (isFlowYamlPath(path)) {
                    blobShas.add(parts[2]);
                }
            }
        }

        int flowCount = blobShas.size();
        int scheduledFlowCount = blobShas.isEmpty() ? 0 : countEnabledSchedulesBatch(repoPath, blobShas);
        return new CachedCommitSummary(headCommitMessage, headCommitAt, flowCount, scheduledFlowCount);
    }

    private int countEnabledSchedulesBatch(Path repoPath, List<String> blobShas) {
        Process process;
        try {
            process = new ProcessBuilder("git", "-C", repoPath.toString(), "cat-file", "--batch")
                    .start();
        } catch (IOException ex) {
            throw new IllegalStateException("启动 git cat-file --batch 失败", ex);
        }

        CompletableFuture<Void> stdinFuture = CompletableFuture.runAsync(() -> {
            try (OutputStream out = process.getOutputStream()) {
                for (String sha : blobShas) {
                    out.write((sha + "\n").getBytes(StandardCharsets.UTF_8));
                }
                out.flush();
            } catch (IOException ex) {
                throw new IllegalStateException("写入 git cat-file --batch 输入失败", ex);
            }
        });

        CompletableFuture<byte[]> stderrFuture = CompletableFuture.supplyAsync(() -> {
            try {
                return process.getErrorStream().readAllBytes();
            } catch (IOException ex) {
                return new byte[0];
            }
        });

        int enabledCount = 0;
        try (BufferedInputStream in = new BufferedInputStream(process.getInputStream())) {
            for (int i = 0; i < blobShas.size(); i++) {
                String header = readAsciiLine(in);
                if (header == null) {
                    break;
                }
                String[] parts = header.split(" ");
                if (parts.length == 2 && "missing".equals(parts[1])) {
                    continue;
                }
                if (parts.length < 3) {
                    log.warn("无法解析 git cat-file --batch 输出头: {}", header);
                    break;
                }
                int size = Integer.parseInt(parts[2]);
                byte[] payload = in.readNBytes(size);
                if (payload.length != size) {
                    log.warn("git cat-file --batch 内容长度不完整: expected={}, actual={}", size, payload.length);
                    break;
                }
                // git cat-file --batch appends a trailing LF after each object payload
                in.read();

                String yamlContent = new String(payload, StandardCharsets.UTF_8);
                try {
                    OfflineFlowYamlSupport.ScheduleData schedule = yamlSupport.readSchedule(yamlContent);
                    if (schedule != null && schedule.enabled()) {
                        enabledCount++;
                    }
                } catch (RuntimeException ignored) {
                    // Malformed YAML in historical commits should not break workspace summary.
                }
            }

            if (!process.waitFor(BATCH_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                throw new IllegalStateException("执行 git cat-file --batch 超时");
            }
            stdinFuture.join();
            byte[] stderr = stderrFuture.join();
            if (process.exitValue() != 0) {
                String errMsg = new String(stderr, StandardCharsets.UTF_8).trim();
                throw new IllegalStateException("执行 git cat-file --batch 失败: " + errMsg);
            }
            return enabledCount;
        } catch (IOException ex) {
            process.destroyForcibly();
            throw new IllegalStateException("读取 git cat-file --batch 输出失败", ex);
        } catch (InterruptedException ex) {
            process.destroyForcibly();
            Thread.currentThread().interrupt();
            throw new IllegalStateException("执行 git cat-file --batch 被中断", ex);
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

    private boolean isFlowYamlPath(String rawPath) {
        if (rawPath == null || rawPath.isBlank()) {
            return false;
        }
        String normalized = rawPath.replace('\\', '/');
        if (!"_flows/flow.yaml".equals(normalized)
                && !(normalized.startsWith("_flows/") && normalized.endsWith("/flow.yaml"))) {
            return false;
        }
        for (String segment : normalized.split("/")) {
            if (segment.startsWith(".")) {
                return false;
            }
        }
        return true;
    }

    private boolean isGitRepoInitialized(Path repoPath) {
        return Files.isDirectory(repoPath) && OfflineProperties.isGitRepoInitialized(repoPath);
    }

    private boolean isValidBranchName(String branch) {
        if (branch == null || branch.isBlank()) {
            return false;
        }
        String trimmed = branch.trim();
        if (trimmed.startsWith("-") || trimmed.contains("..") || trimmed.contains("@{") || trimmed.contains("\\")) {
            return false;
        }
        for (int i = 0; i < trimmed.length(); i++) {
            char c = trimmed.charAt(i);
            if (Character.isWhitespace(c) || c == '\0') {
                return false;
            }
        }
        return true;
    }

    private String stripOriginPrefix(String remoteRef) {
        return remoteRef.startsWith("origin/") ? remoteRef.substring("origin/".length()) : remoteRef;
    }

    private BranchSnapshotSummary notFound(String branch) {
        return new BranchSnapshotSummary(branch, false, null, null, null, false, false, 0, 0);
    }

    private String tryRunGit(Path repoPath, String... args) {
        List<String> command = new ArrayList<>(args.length + 3);
        command.add("git");
        command.add("-C");
        command.add(repoPath.toString());
        command.addAll(List.of(args));
        try {
            Process process = new ProcessBuilder(command)
                    .redirectErrorStream(true)
                    .start();
            if (!process.waitFor(GIT_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                throw new IllegalStateException("执行 git 命令超时: " + String.join(" ", command));
            }
            String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8).trim();
            return process.exitValue() == 0 ? output : null;
        } catch (IOException ex) {
            throw new IllegalStateException("执行 git 命令失败", ex);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("执行 git 命令被中断", ex);
        }
    }
}
