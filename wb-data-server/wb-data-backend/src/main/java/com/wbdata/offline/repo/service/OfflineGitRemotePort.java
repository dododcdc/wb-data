package com.wbdata.offline.repo.service;

import java.util.Optional;

/**
 * offline 域对 git 远程能力的端口：工作树推送/关联远程仓库所需的最小操作集。
 * 由 git 包的 GitRemoteAccessAdapter 实现，隔离远程平台 Provider 与 GitConfigService 访问。
 */
public interface OfflineGitRemotePort {

    record GitRemoteCredentials(String username, String token) {}

    record GitRuntimeCredentials(String provider, String repositoryUrl, String username, String token) {}

    /** 当前项目组是否已配置 git 远程 */
    boolean isConfigured(Long groupId);

    /** 远程仓库是否已存在 */
    boolean repositoryExists(Long groupId, String repoName);

    /** 创建远程仓库 */
    void createRepository(Long groupId, String repoName, boolean isPrivate);

    /** 构建不含 token 的展示 URL */
    String buildDisplayUrl(Long groupId, String repoName);

    /** 按需解析当前项目组用于 GIT_ASKPASS 的认证凭据 */
    default Optional<GitRemoteCredentials> resolveCredentials(Long groupId) {
        return Optional.empty();
    }

    /** 解析 Kestra Git 运行时同步所需的仓库地址与明文凭据 */
    default GitRuntimeCredentials requireRuntimeCredentials(Long groupId) {
        throw new UnsupportedOperationException("Git runtime credentials port not configured");
    }
}
