package com.wbdata.git.service.provider;

/**
 * Git 远程提供商接口
 */
public interface GitRemoteProvider {

    /** 提供商类型标识 */
    String provider();

    /** 验证 token 是否有效 */
    void validateToken();

    /** 当前用户名 */
    String getUsername();

    /** 检查远程仓库是否已存在 */
    boolean repositoryExists(String repoName);

    /** 创建远程仓库 */
    void createRepository(String repoName, boolean isPrivate);

    /** 构建 push 用的 remote URL（不含 token，明文显示） */
    String buildDisplayUrl(String repoName);

    /** 构建带 token 的 remote URL */
    String buildPushUrl(String repoName);
}
