package com.wbdata.offline.repo.service;

import com.wbdata.offline.config.OfflineProperties;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileAttribute;
import java.nio.file.attribute.PosixFilePermission;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

/**
 * git 进程执行与仓库级原语（存在性检查、当前分支/remote 读取、分支名校验、GIT_ASKPASS 远端认证），
 * 供 GitCommandService（提交/推送）、GitBranchOperations（分支管理）与 OfflineFlowVersionService（版本历史查询）共用。
 */
abstract class GitRepositoryOperations {

    static final String GIT_USERNAME_ENV = "WB_DATA_GIT_USERNAME";
    static final String GIT_PASSWORD_ENV = "WB_DATA_GIT_PASSWORD";

    private static final Pattern URL_CREDENTIAL_PATTERN =
            Pattern.compile("([a-zA-Z][a-zA-Z0-9+.-]*://)([^/\\s@]+)@");

    private static final String ASKPASS_SCRIPT_BODY = """
            #!/bin/sh
            case "$1" in
              *[Uu]sername*) printf '%s\\n' "$WB_DATA_GIT_USERNAME" ;;
              *[Pp]assword*) printf '%s\\n' "$WB_DATA_GIT_PASSWORD" ;;
              *) printf '\\n' ;;
            esac
            """;

    private static final FileAttribute<Set<PosixFilePermission>> OWNER_RWX_ATTR =
            PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwx------"));

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
            String output = runGit(repoPath, "remote", "get-url", "origin");
            return (output == null || output.isBlank()) ? null : output.trim();
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

    protected static String stripCredentials(String remoteUrl) {
        if (remoteUrl == null) {
            return null;
        }
        int schemeIndex = remoteUrl.indexOf("://");
        if (schemeIndex < 0) {
            return remoteUrl;
        }
        int authorityStart = schemeIndex + 3;
        int pathStart = remoteUrl.indexOf('/', authorityStart);
        int authorityEnd = pathStart < 0 ? remoteUrl.length() : pathStart;
        if (authorityEnd <= authorityStart) {
            return remoteUrl;
        }
        int credentialEnd = remoteUrl.lastIndexOf('@', authorityEnd - 1);
        if (credentialEnd < authorityStart) {
            return remoteUrl;
        }
        return remoteUrl.substring(0, authorityStart) + remoteUrl.substring(credentialEnd + 1);
    }

    protected static boolean isHttpRemoteUrl(String remoteUrl) {
        if (remoteUrl == null) {
            return false;
        }
        String normalized = remoteUrl.trim().toLowerCase(Locale.ROOT);
        return normalized.startsWith("http://") || normalized.startsWith("https://");
    }

    protected static boolean hasEmbeddedHttpCredentials(String remoteUrl) {
        return isHttpRemoteUrl(remoteUrl) && !remoteUrl.equals(stripCredentials(remoteUrl));
    }

    /**
     * 执行需要访问远端仓库的 git 命令：自动清洗历史含凭据的 HTTP origin，并通过临时 0700 GIT_ASKPASS 脚本注入凭据。
     */
    protected String runRemoteGit(Path repoPath, OfflineGitRemotePort remotePort, Long groupId, String... args) {
        String currentRemote = getCurrentRemote(repoPath);
        if (hasEmbeddedHttpCredentials(currentRemote)) {
            String sanitizedUrl = stripCredentials(currentRemote);
            runGit(repoPath, "remote", "set-url", "origin", sanitizedUrl);
            currentRemote = sanitizedUrl;
        }

        Optional<OfflineGitRemotePort.GitRemoteCredentials> credentials =
                (isHttpRemoteUrl(currentRemote) && remotePort != null && groupId != null)
                        ? Optional.ofNullable(remotePort.resolveCredentials(groupId)).flatMap(opt -> opt)
                        : Optional.empty();

        Map<String, String> env = new LinkedHashMap<>();
        env.put("GIT_TERMINAL_PROMPT", "0");
        env.put("GCM_INTERACTIVE", "never");

        if (credentials.isEmpty()) {
            return runGitWithEnv(repoPath, env, args);
        }

        Path askPassScript = createAskPassScript();
        try {
            env.put("GIT_ASKPASS", askPassScript.toAbsolutePath().toString());
            env.put(GIT_USERNAME_ENV, Objects.requireNonNullElse(credentials.get().username(), "oauth2"));
            env.put(GIT_PASSWORD_ENV, credentials.get().token());

            String[] commandArgs = new String[args.length + 2];
            commandArgs[0] = "-c";
            commandArgs[1] = "credential.helper=";
            System.arraycopy(args, 0, commandArgs, 2, args.length);
            return runGitWithEnv(repoPath, env, commandArgs);
        } finally {
            try {
                Files.deleteIfExists(askPassScript);
            } catch (IOException ignored) {
                // Best-effort temp askpass script cleanup.
            }
        }
    }

    private Path createAskPassScript() {
        try {
            Path script;
            try {
                script = Files.createTempFile("wb-data-git-askpass-", ".sh", OWNER_RWX_ATTR);
            } catch (UnsupportedOperationException ex) {
                script = Files.createTempFile("wb-data-git-askpass-", ".sh");
                if (!script.toFile().setReadable(false, false)
                        || !script.toFile().setReadable(true, true)
                        || !script.toFile().setWritable(true, true)
                        || !script.toFile().setExecutable(true, true)) {
                    throw new IOException("无法设置临时 GIT_ASKPASS 脚本权限: " + script);
                }
            }
            Files.writeString(script, ASKPASS_SCRIPT_BODY, StandardCharsets.UTF_8);
            return script;
        } catch (IOException ex) {
            throw new IllegalStateException("创建临时 GIT_ASKPASS 脚本失败", ex);
        }
    }

    protected static String sanitizeGitOutput(String output, Map<String, String> env) {
        if (output == null || output.isEmpty()) {
            return output;
        }
        String sanitized = URL_CREDENTIAL_PATTERN.matcher(output).replaceAll("$1***@");
        if (env != null) {
            String secret = env.get(GIT_PASSWORD_ENV);
            if (secret != null && !secret.isBlank()) {
                sanitized = sanitized.replace(secret, "***");
            }
        }
        return sanitized;
    }

    protected String runGit(Path repoPath, String... args) {
        return runGitWithEnv(repoPath, Map.of(), args);
    }

    protected String runGitWithEnv(Path repoPath, Map<String, String> env, String... args) {
        return runGitWithEnvAndInput(repoPath, env, null, args);
    }

    protected String runGitWithEnvAndInput(Path repoPath, Map<String, String> env, String stdinInput, String... args) {
        List<String> command = new ArrayList<>();
        command.add("git");
        command.add("-C");
        command.add(repoPath.toString());
        command.addAll(List.of(args));

        try {
            ProcessBuilder builder = new ProcessBuilder(command)
                    .redirectErrorStream(true);
            if (env != null && !env.isEmpty()) {
                builder.environment().putAll(env);
            }
            Process process = builder.start();
            try (java.io.OutputStream stdin = process.getOutputStream()) {
                if (stdinInput != null) {
                    stdin.write(stdinInput.getBytes(StandardCharsets.UTF_8));
                }
            }
            String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8).trim();
            if (!process.waitFor(30, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Git 命令执行超时");
            }
            if (process.exitValue() != 0) {
                throw new GitException(sanitizeGitOutput(output, env));
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
