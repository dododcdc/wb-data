package com.wbdata.git.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.wbdata.git.entity.WbGitConfig;
import com.wbdata.git.mapper.WbGitConfigMapper;
import com.wbdata.git.service.provider.GitHubRemoteProvider;
import com.wbdata.git.service.provider.GitLabRemoteProvider;
import com.wbdata.git.service.provider.GitRemoteProvider;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
@RequiredArgsConstructor
public class GitConfigService {

    private final WbGitConfigMapper gitConfigMapper;
    private final GitHubRemoteProvider githubProvider;
    private final GitLabRemoteProvider gitlabProvider;

    private static final String AES_KEY_ENV = "WB_DATA_GIT_TOKEN_KEY";

    /** 内存缓存当前 provider 实例，按 groupId 区分 */
    private final Map<Long, GitRemoteProvider> currentProviderCache = new ConcurrentHashMap<>();

    /**
     * 获取指定项目组的 provider
     */
    public GitRemoteProvider getProvider(Long groupId) {
        WbGitConfig config = loadConfig(groupId);
        if (config == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Git 推送未配置，请先在项目组设置中配置");
        }
        return resolveProvider(config);
    }

    /**
     * 快速获取 provider，不抛异常
     */
    public GitRemoteProvider getProviderIfConfigured(Long groupId) {
        WbGitConfig config = loadConfig(groupId);
        if (config == null) {
            return null;
        }
        return resolveProvider(config);
    }

    /**
     * 验证配置是否已保存
     */
    public boolean isConfigured(Long groupId) {
        return loadConfig(groupId) != null;
    }

    /**
     * 获取当前配置（token 脱敏返回）
     */
    public WbGitConfig getConfig(Long groupId) {
        WbGitConfig config = loadConfig(groupId);
        if (config == null) {
            return null;
        }
        if (config.getToken() != null && config.getToken().length() > 4) {
            config.setToken(maskToken(config.getToken()));
        }
        return config;
    }

    /**
     * 获取当前配置版本（用于检测切换）
     */
    public String getConfigVersion(Long groupId) {
        WbGitConfig config = loadConfig(groupId);
        if (config == null) {
            return null;
        }
        return config.getProvider() + ":" + config.getBaseUrl();
    }

    /**
     * 保存配置，token 为空时保留原值
     */
    public void saveConfig(Long groupId, String provider, String username, String token, String baseUrl, Long operatorId) {
        // 先查加密态 token（loadConfig 会把它覆盖为解密值，所以先存起来）
        WbGitConfig raw = gitConfigMapper.selectOne(new LambdaQueryWrapper<WbGitConfig>()
                .eq(WbGitConfig::getProjectGroupId, groupId));
        String encryptedToken = raw != null ? raw.getToken() : null;

        WbGitConfig existing = loadConfig(groupId);
        WbGitConfig config = new WbGitConfig();
        config.setProjectGroupId(groupId);
        config.setProvider(provider);
        config.setUsername(username);
        if (token != null && !token.isBlank()) {
            config.setToken(encryptToken(token));
        } else if (encryptedToken != null) {
            // 保留原加密 token
            config.setToken(encryptedToken);
        }
        config.setBaseUrl(normalizeBaseUrl(provider, baseUrl));
        config.setUpdatedBy(operatorId);

        if (existing == null) {
            gitConfigMapper.insert(config);
        } else {
            config.setId(existing.getId());
            gitConfigMapper.updateById(config);
        }
        // 清除缓存
        currentProviderCache.remove(groupId);
    }

    /**
     * 删除配置
     */
    public void deleteConfig(Long groupId) {
        WbGitConfig existing = loadConfig(groupId);
        if (existing != null) {
            gitConfigMapper.deleteById(existing.getId());
            currentProviderCache.remove(groupId);
        }
    }

    /**
     * 测试连接
     */
    public String testConnection(String provider, String username, String token, String baseUrl) {
        GitRemoteProvider p = createProviderInstance(provider, username, token, normalizeBaseUrl(provider, baseUrl));
        p.validateToken();
        return "连接成功，当前账号: " + p.getUsername();
    }

    private WbGitConfig loadConfig(Long groupId) {
        WbGitConfig config = gitConfigMapper.selectOne(new LambdaQueryWrapper<WbGitConfig>()
                .eq(WbGitConfig::getProjectGroupId, groupId));
        if (config != null && config.getToken() != null) {
            config.setToken(decryptToken(config.getToken()));
        }
        return config;
    }

    private GitRemoteProvider resolveProvider(WbGitConfig config) {
        Long groupId = config.getProjectGroupId();
        if (currentProviderCache.containsKey(groupId)) {
            return currentProviderCache.get(groupId);
        }
        GitRemoteProvider provider = createProviderInstance(
                config.getProvider(),
                config.getUsername(),
                config.getToken(),
                config.getBaseUrl()
        );
        currentProviderCache.put(groupId, provider);
        return provider;
    }

    private GitRemoteProvider createProviderInstance(String provider, String username, String token, String baseUrl) {
        return switch (provider) {
            case "github" -> {
                GitHubRemoteProvider p = new GitHubRemoteProvider(new com.fasterxml.jackson.databind.ObjectMapper());
                p.init(username, token, baseUrl);
                yield p;
            }
            case "gitlab" -> {
                GitLabRemoteProvider p = new GitLabRemoteProvider(new com.fasterxml.jackson.databind.ObjectMapper());
                p.init(username, token, baseUrl);
                yield p;
            }
            default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "不支持的 provider: " + provider);
        };
    }

    private String normalizeBaseUrl(String provider, String baseUrl) {
        if (baseUrl != null && !baseUrl.isBlank()) {
            return baseUrl.replaceFirst("/$", "");
        }
        return switch (provider) {
            case "github" -> "https://github.com";
            case "gitlab" -> "https://gitlab.com";
            default -> "";
        };
    }

    /** 简单 AES 加密（token 存 DB 时使用） */
    private String encryptToken(String token) {
        try {
            String key = System.getenv(AES_KEY_ENV);
            if (key == null || key.isBlank()) {
                return Base64.getEncoder().encodeToString(token.getBytes(StandardCharsets.UTF_8));
            }
            MessageDigest sha = MessageDigest.getInstance("SHA-256");
            byte[] keyBytes = sha.digest(key.getBytes(StandardCharsets.UTF_8));
            byte[] cipher = new byte[keyBytes.length];
            byte[] input = token.getBytes(StandardCharsets.UTF_8);
            for (int i = 0; i < input.length; i++) {
                cipher[i] = (byte) (input[i] ^ keyBytes[i % keyBytes.length]);
            }
            return Base64.getEncoder().encodeToString(cipher);
        } catch (Exception ex) {
            throw new RuntimeException("加密 token 失败", ex);
        }
    }

    private String decryptToken(String encrypted) {
        try {
            String key = System.getenv(AES_KEY_ENV);
            if (key == null || key.isBlank()) {
                return new String(Base64.getDecoder().decode(encrypted), StandardCharsets.UTF_8);
            }
            MessageDigest sha = MessageDigest.getInstance("SHA-256");
            byte[] keyBytes = sha.digest(key.getBytes(StandardCharsets.UTF_8));
            byte[] cipher = Base64.getDecoder().decode(encrypted);
            byte[] plain = new byte[cipher.length];
            for (int i = 0; i < cipher.length; i++) {
                plain[i] = (byte) (cipher[i] ^ keyBytes[i % keyBytes.length]);
            }
            return new String(plain, StandardCharsets.UTF_8);
        } catch (Exception ex) {
            throw new RuntimeException("解密 token 失败", ex);
        }
    }

    private String maskToken(String token) {
        if (token.length() <= 4) {
            return "****";
        }
        return token.substring(0, 4) + "****";
    }
}
