package com.wbdata.git.service;

import com.wbdata.git.entity.WbGitConfig;
import com.wbdata.offline.repo.service.OfflineGitRemotePort;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.Optional;

/**
 * offline 域 git 远程端口的适配器：委托 GitConfigService 解析当前组的 provider 与按需凭据。
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
    public String buildDisplayUrl(Long groupId, String repoName) {
        return gitConfigService.getProvider(groupId).buildDisplayUrl(repoName);
    }

    @Override
    public Optional<GitRemoteCredentials> resolveCredentials(Long groupId) {
        WbGitConfig config = gitConfigService.getDecryptedConfigIfConfigured(groupId);
        if (config == null || config.getToken() == null || config.getToken().isBlank()) {
            return Optional.empty();
        }
        String username = (config.getUsername() == null || config.getUsername().isBlank())
                ? "oauth2"
                : config.getUsername();
        return Optional.of(new GitRemoteCredentials(username, config.getToken()));
    }
}
