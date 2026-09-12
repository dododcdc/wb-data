package com.wbdata.git.service;

import com.wbdata.offline.service.OfflineGitRemotePort;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * offline 域 git 远程端口的适配器：委托 GitConfigService 解析当前组的 provider。
 */
@Service
@RequiredArgsConstructor
public class GitRemoteAccessAdapter implements OfflineGitRemotePort {

    private final GitConfigService gitConfigService;

    @Override
    public boolean isConfigured(Long groupId) {
        return gitConfigService.isConfigured(groupId);
    }

    @Override
    public boolean repositoryExists(Long groupId, String repoName) {
        return gitConfigService.getProvider(groupId).repositoryExists(repoName);
    }

    @Override
    public void createRepository(Long groupId, String repoName, boolean isPrivate) {
        gitConfigService.getProvider(groupId).createRepository(repoName, isPrivate);
    }

    @Override
    public String buildPushUrl(Long groupId, String repoName) {
        return gitConfigService.getProvider(groupId).buildPushUrl(repoName);
    }

    @Override
    public String buildDisplayUrl(Long groupId, String repoName) {
        return gitConfigService.getProvider(groupId).buildDisplayUrl(repoName);
    }
}
