package com.wbdata.offline.repo.service;

import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.repo.dto.OfflineRepoStatusResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;

@Service
@RequiredArgsConstructor
public class OfflineRepoStatusService {

    private static final String OID_PREFIX = "# branch.oid ";
    private static final String HEAD_PREFIX = "# branch.head ";
    private static final String UPSTREAM_PREFIX = "# branch.upstream ";
    private static final String AB_PREFIX = "# branch.ab ";

    private final OfflineProperties offlineProperties;
    private final GitWorkingTreeStatus workingTreeStatus = new GitWorkingTreeStatus();

    public Set<String> listDirtyFlowPaths(Long groupId) {
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        if (!Files.isDirectory(repoPath) || !Files.isDirectory(repoPath.resolve(".git"))) {
            return Set.of();
        }
        String porcelain = runGitCommand(repoPath, "status", "--porcelain");
        List<String> changedFlows = workingTreeStatus.inspect(porcelain).changedFlows();
        if (changedFlows == null || changedFlows.isEmpty()) {
            return Set.of();
        }
        Set<String> normalized = new LinkedHashSet<>(changedFlows.size());
        for (String flowPath : changedFlows) {
            if (flowPath != null && !flowPath.isBlank()) {
                normalized.add(flowPath.replace('\\', '/'));
            }
        }
        return Set.copyOf(normalized);
    }

    public OfflineRepoStatusResponse getRepoStatus(Long groupId) {
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        if (!Files.isDirectory(repoPath)) {
            return new OfflineRepoStatusResponse(
                    groupId,
                    repoPath.toString(),
                    false,
                    false,
                    false,
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
                    false,
                    false,
                    false,
                    null,
                    null,
                    null,
                    null
            );
        }

        String statusOutput = runGitCommandRaw(repoPath, "status", "--porcelain=v2", "--branch");
        ParsedStatus parsed = parsePorcelainV2Status(statusOutput);

        String headCommitMessage = null;
        Instant headCommitAt = null;
        if (parsed.headCommitId() != null) {
            String logOutput = runGitCommandRaw(repoPath, "log", "-1", "--format=%ct%n%s");
            String[] lines = logOutput.split("\\R", 2);
            if (lines.length >= 1 && !lines[0].isBlank()) {
                headCommitAt = Instant.ofEpochSecond(Long.parseLong(lines[0].trim()));
            }
            headCommitMessage = lines.length >= 2 ? lines[1].trim() : "";
        }

        boolean hasRemote = parsed.hasUpstream();
        if (!hasRemote) {
            String remoteOutput = runGitCommandRaw(repoPath, "remote").trim();
            hasRemote = !remoteOutput.isBlank();
        }

        return new OfflineRepoStatusResponse(
                groupId,
                repoPath.toString(),
                true,
                true,
                parsed.dirty(),
                parsed.ahead(),
                hasRemote,
                parsed.hasUpstream(),
                parsed.branch(),
                parsed.headCommitId(),
                headCommitMessage,
                headCommitAt
        );
    }

    private ParsedStatus parsePorcelainV2Status(String statusOutput) {
        String headCommitId = null;
        String branch = null;
        boolean hasUpstream = false;
        boolean ahead = false;
        boolean dirty = false;

        for (String line : statusOutput.split("\\R")) {
            if (line.isBlank()) {
                continue;
            }
            if (line.startsWith(OID_PREFIX)) {
                String oid = line.substring(OID_PREFIX.length()).trim();
                headCommitId = "(initial)".equals(oid) || oid.isBlank() ? null : oid;
            } else if (line.startsWith(HEAD_PREFIX)) {
                String head = line.substring(HEAD_PREFIX.length()).trim();
                if ("(detached)".equals(head)) {
                    branch = "HEAD";
                } else if (!head.isBlank()) {
                    branch = head;
                }
            } else if (line.startsWith(UPSTREAM_PREFIX)) {
                String upstream = line.substring(UPSTREAM_PREFIX.length()).trim();
                hasUpstream = !upstream.isBlank();
            } else if (line.startsWith(AB_PREFIX)) {
                ahead = parseAheadPositive(line.substring(AB_PREFIX.length()).trim());
            } else if (!line.startsWith("# ")) {
                dirty = true;
            }
        }
        return new ParsedStatus(headCommitId, branch, hasUpstream, ahead, dirty);
    }

    private boolean parseAheadPositive(String abSummary) {
        for (String token : abSummary.split("\\s+")) {
            if (token.startsWith("+") && token.length() > 1) {
                try {
                    return Integer.parseInt(token.substring(1)) > 0;
                } catch (NumberFormatException ignored) {
                    return false;
                }
            }
        }
        return false;
    }

    private String runGitCommandRaw(Path repoPath, String... args) {
        List<String> command = new java.util.ArrayList<>();
        command.add("git");
        command.add("--no-optional-locks");
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

            String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            if (process.exitValue() != 0) {
                throw new IllegalStateException("执行 git 命令失败: " + output.trim());
            }
            return output;
        } catch (IOException ex) {
            throw new IllegalStateException("执行 git 命令失败", ex);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("执行 git 命令被中断", ex);
        }
    }

    private record ParsedStatus(
            String headCommitId,
            String branch,
            boolean hasUpstream,
            boolean ahead,
            boolean dirty
    ) {
    }
}
