package com.wbdata.git.service;

import com.wbdata.git.entity.WbGitConfig;
import com.wbdata.git.entity.WbGitSyncConfig;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Locale;

final class GitSyncFlowSourceBuilder {
    static final String SYSTEM_NAMESPACE = "system";

    private static final int KESTRA_IDENTIFIER_MAX_LENGTH = 150;

    private GitSyncFlowSourceBuilder() {
    }

    static String buildKestraNamespace(Long groupId, String branch) {
        return boundedIdentifier("g" + groupId + "-", branch);
    }

    static String buildSyncFlowId(Long groupId, String branch) {
        return boundedIdentifier("sync-flows-g" + groupId + "-", branch);
    }

    static String buildSyncFlowSource(WbGitConfig gitConfig, WbGitSyncConfig config, String syncCron) {
        Long groupId = config.getGroupId();
        String branch = config.getBranch();
        String namespace = buildKestraNamespace(groupId, branch);
        String syncFlowId = buildSyncFlowId(groupId, branch);
        String repositoryUrl = buildRepositoryUrl(gitConfig, groupId);
        boolean disabled = !Boolean.TRUE.equals(config.getEnabled());

        return """
                id: %s
                namespace: system
                description: "Auto-sync wb-data group %s branch %s"
                inputs:
                  - id: git_username
                    type: STRING
                    defaults: "%s"
                  - id: git_token
                    type: STRING
                    defaults: "%s"
                triggers:
                  - id: schedule
                    type: io.kestra.plugin.core.trigger.Schedule
                    cron: "%s"
                    disabled: %s
                tasks:
                  - id: sync_flows
                    type: io.kestra.plugin.git.SyncFlows
                    url: "%s"
                    branch: %s
                    username: "{{ inputs.git_username }}"
                    password: "{{ inputs.git_token }}"
                    targetNamespace: %s
                    gitDirectory: .wb-data/kestra-flows
                    delete: true
                  - id: sync_files
                    type: io.kestra.plugin.git.SyncNamespaceFiles
                    url: "%s"
                    branch: %s
                    username: "{{ inputs.git_username }}"
                    password: "{{ inputs.git_token }}"
                    namespace: %s
                    gitDirectory: .
                    delete: true
                """.formatted(
                syncFlowId,
                groupId,
                yamlDoubleQuoted(branch),
                yamlDoubleQuoted(gitConfig.getUsername()),
                yamlDoubleQuoted(gitConfig.getToken()),
                yamlDoubleQuoted(syncCron),
                disabled,
                yamlDoubleQuoted(repositoryUrl),
                branch,
                namespace,
                yamlDoubleQuoted(repositoryUrl),
                branch,
                namespace
        );
    }

    private static String boundedIdentifier(String prefix, String branch) {
        String slug = slugBranch(branch);
        if ((prefix + slug).length() <= KESTRA_IDENTIFIER_MAX_LENGTH) {
            return prefix + slug;
        }
        String hash = sha256Hex(branch).substring(0, 8);
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

    private static String buildRepositoryUrl(WbGitConfig config, Long groupId) {
        return config.getBaseUrl().replaceFirst("/$", "") + "/"
                + config.getUsername() + "/wb-data-" + groupId + ".git";
    }

    private static String yamlDoubleQuoted(String value) {
        return value == null ? "" : value.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
