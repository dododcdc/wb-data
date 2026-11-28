package com.wbdata.git.service;

import com.wbdata.git.entity.WbGitSyncConfig;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Locale;

public final class GitSyncFlowSourceBuilder {
    static final String SYSTEM_NAMESPACE = "system";

    private static final int KESTRA_IDENTIFIER_MAX_LENGTH = 150;
    private static final String DEFAULT_INTERNAL_TOKEN_ENV = "WB_DATA_INTERNAL_TOKEN";

    private GitSyncFlowSourceBuilder() {
    }

    /** 运行时命名空间推导：g<groupId>-<branch>，与依赖闸门 WaitUpstream 的推导保持一致。 */
    public static String buildKestraNamespace(Long groupId, String branch) {
        return boundedIdentifier("g" + groupId + "-", branch);
    }

    public static String buildSyncFlowId(Long groupId, String branch) {
        return boundedIdentifier("sync-flows-g" + groupId + "-", branch);
    }

    static String buildSyncFlowSource(WbGitSyncConfig config,
                                      String syncCron,
                                      String internalBaseUrl,
                                      String internalTokenEnv) {
        Long groupId = config.getGroupId();
        String branch = config.getBranch();
        String namespace = buildKestraNamespace(groupId, branch);
        String syncFlowId = buildSyncFlowId(groupId, branch);
        boolean disabled = !Boolean.TRUE.equals(config.getEnabled());
        String effectiveTokenEnv = internalTokenEnv == null || internalTokenEnv.isBlank()
                ? DEFAULT_INTERNAL_TOKEN_ENV
                : internalTokenEnv.trim();
        String internalBaseUrlLine = internalBaseUrl == null || internalBaseUrl.isBlank()
                ? ""
                : "    internalBaseUrl: \"" + yamlDoubleQuoted(internalBaseUrl.trim()) + "\"\n";

        return """
                id: %s
                namespace: system
                description: "Auto-sync wb-data group %s branch %s"
                concurrency:
                  limit: 1
                  behavior: QUEUE
                triggers:
                  - id: schedule
                    type: io.kestra.plugin.core.trigger.Schedule
                    cron: "%s"
                    disabled: %s
                tasks:
                  - id: resolve_git
                    type: io.wbdata.kestra.core.ResolveGitCredentials
                    groupId: %s
                %s    internalToken: "{{ secret('%s') }}"
                  - id: resolve_start
                    type: io.wbdata.kestra.core.GitRemoteRevision
                    url: "{{ outputs.resolve_git.repositoryUrl }}"
                    branch: "%s"
                    username: "{{ outputs.resolve_git.username }}"
                    password: "{{ outputs.resolve_git.token }}"
                  - id: sync_flows
                    type: io.kestra.plugin.git.SyncFlows
                    url: "{{ outputs.resolve_git.repositoryUrl }}"
                    branch: "%s"
                    username: "{{ outputs.resolve_git.username }}"
                    password: "{{ outputs.resolve_git.token }}"
                    targetNamespace: %s
                    gitDirectory: .wb-data/kestra-flows
                    delete: true
                  - id: sync_files
                    type: io.kestra.plugin.git.SyncNamespaceFiles
                    url: "{{ outputs.resolve_git.repositoryUrl }}"
                    branch: "%s"
                    username: "{{ outputs.resolve_git.username }}"
                    password: "{{ outputs.resolve_git.token }}"
                    namespace: %s
                    gitDirectory: .
                    delete: true
                  - id: resolve_end
                    type: io.wbdata.kestra.core.GitRemoteRevision
                    url: "{{ outputs.resolve_git.repositoryUrl }}"
                    branch: "%s"
                    username: "{{ outputs.resolve_git.username }}"
                    password: "{{ outputs.resolve_git.token }}"
                outputs:
                  - id: start_sha
                    type: STRING
                    value: "{{ outputs.resolve_start.sha }}"
                  - id: end_sha
                    type: STRING
                    value: "{{ outputs.resolve_end.sha }}"
                """.formatted(
                syncFlowId,
                groupId,
                yamlDoubleQuoted(branch),
                yamlDoubleQuoted(syncCron),
                disabled,
                groupId,
                internalBaseUrlLine,
                effectiveTokenEnv,
                yamlDoubleQuoted(branch),
                yamlDoubleQuoted(branch),
                namespace,
                yamlDoubleQuoted(branch),
                namespace,
                yamlDoubleQuoted(branch)
        );
    }

    private static String boundedIdentifier(String prefix, String branch) {
        String rawBranch = branch == null ? "" : branch;
        String slug = slugBranch(rawBranch);
        boolean lossySlug = !slug.equals(rawBranch);
        if (!lossySlug && (prefix + slug).length() <= KESTRA_IDENTIFIER_MAX_LENGTH) {
            return prefix + slug;
        }
        String hash = sha256Hex(rawBranch).substring(0, 8);
        int slugMaxLength = KESTRA_IDENTIFIER_MAX_LENGTH - prefix.length() - hash.length() - 1;
        if (slugMaxLength <= 0) {
            throw new IllegalStateException("Kestra 标识前缀过长");
        }
        String truncated = slug.substring(0, Math.min(slug.length(), slugMaxLength)).replaceAll("-+$", "");
        if (truncated.isBlank()) {
            truncated = "branch";
        }
        return prefix + truncated + "-" + hash;
    }

    private static String slugBranch(String branch) {
        String slug = (branch == null || branch.isBlank() ? "branch" : branch)
                .toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("-+", "-")
                .replaceAll("^-|-$", "");
        return slug.isBlank() ? "branch" : slug;
    }

    private static String sha256Hex(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("计算分支哈希失败", ex);
        }
    }

    private static String yamlDoubleQuoted(String value) {
        return value == null ? "" : value
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t");
    }
}
