package com.wbdata.git.service;

import com.wbdata.git.entity.WbGitConfig;
import com.wbdata.offline.repo.service.OfflineGitRemotePort;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class GitRemoteAccessAdapterTest {

    @Test
    void requireRuntimeCredentialsStripsTrailingSlashAndBuildsRepositoryUrl() {
        GitConfigService gitConfigService = mock(GitConfigService.class);
        WbGitConfig config = new WbGitConfig();
        config.setProvider("github");
        config.setBaseUrl("https://github.com/");
        config.setUsername("alice");
        config.setToken("ghp_secret");
        when(gitConfigService.requireDecryptedConfig(4L)).thenReturn(config);

        GitRemoteAccessAdapter adapter = new GitRemoteAccessAdapter(gitConfigService);

        OfflineGitRemotePort.GitRuntimeCredentials creds = adapter.requireRuntimeCredentials(4L);

        assertThat(creds).isEqualTo(new OfflineGitRemotePort.GitRuntimeCredentials(
                "github",
                "https://github.com/alice/wb-data-4.git",
                "alice",
                "ghp_secret"
        ));
    }
}
