package com.wbdata.offline.repo.service;

/**
 * offline 域对 git 远程能力的端口：工作树推送/关联远程仓库所需的最小操作集。
 * 由 git 包的 GitRemoteAccessAdapter 实现，隔离远程平台 Provider 与 GitConfigService 访问。
 */
public interface OfflineGitRemotePort {

    /** 当前项目组是否已配置 git 远程 */
    boolean isConfigured(Long groupId);

    /** 远程仓库是否已存在 */
    boolean repositoryExists(Long groupId, String repoName);

    /** 创建远程仓库 */
    void createRepository(Long groupId, String repoName, boolean isPrivate);

    /** 构建带 token 的 push URL */
    String buildPushUrl(Long groupId, String repoName);

    /** 构建不含 token 的展示 URL */
    String buildDisplayUrl(Long groupId, String repoName);
}
