package com.wbdata.offline.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Locale;

@Component
@ConfigurationProperties(prefix = "wbdata.offline.kestra")
public class OfflineKestraProperties {
    private static final int KESTRA_NAMESPACE_MAX_LENGTH = 150;
    private static final int DEFAULT_BRANCH_SLUG_MAX_LENGTH = 48;

    private String baseUrl = "http://localhost:8090";
    private String tenant = "main";
    private String username;
    private String password;
    private String debugNamespacePrefix = "wb-debug-g";

    public String getBaseUrl() {
        return baseUrl;
    }

    public void setBaseUrl(String baseUrl) {
        this.baseUrl = baseUrl;
    }

    public String getTenant() {
        return tenant;
    }

    public void setTenant(String tenant) {
        this.tenant = tenant;
    }

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public String getPassword() {
        return password;
    }

    public void setPassword(String password) {
        this.password = password;
    }

    public String getDebugNamespacePrefix() {
        return debugNamespacePrefix;
    }

    public void setDebugNamespacePrefix(String debugNamespacePrefix) {
        this.debugNamespacePrefix = debugNamespacePrefix;
    }

    public String buildDebugNamespace(Long groupId, Long userId) {
        return debugNamespacePrefix + groupId + "-u" + userId;
    }

    public String buildDebugNamespace(Long groupId, Long userId, String branch) {
        String prefix = debugNamespacePrefix + groupId + "-b";
        String suffix = "-u" + userId;
        return prefix + buildBranchKey(branch, KESTRA_NAMESPACE_MAX_LENGTH - prefix.length() - suffix.length()) + suffix;
    }

    public String buildDebugNamespacePrefix(Long groupId) {
        return debugNamespacePrefix + groupId + "-";
    }

    private String buildBranchKey(String branch, int maxLength) {
        if (maxLength < 8) {
            throw new IllegalStateException("Kestra debug namespace prefix is too long");
        }
        String hash = sha256Hex(branch == null ? "" : branch).substring(0, 8);
        String slug = slugBranch(branch);
        if (maxLength == 8) {
            return hash;
        }
        int slugMaxLength = Math.min(DEFAULT_BRANCH_SLUG_MAX_LENGTH, maxLength - 9);
        if (slugMaxLength <= 0) {
            return hash;
        }
        if (slug.length() > slugMaxLength) {
            slug = slug.substring(0, slugMaxLength);
            slug = slug.replaceAll("-+$", "");
            if (slug.isBlank()) {
                slug = "branch";
            }
        }
        return slug + "-" + hash;
    }

    private String slugBranch(String branch) {
        String slug = (branch == null || branch.isBlank() ? "branch" : branch)
                .toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("-+", "-")
                .replaceAll("^-|-$", "");
        return slug.isBlank() ? "branch" : slug;
    }

    private String sha256Hex(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("计算分支哈希失败", ex);
        }
    }
}
