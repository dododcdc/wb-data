package com.wbdata.git.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.wbdata.git.entity.WbGitConfig;
import com.wbdata.git.mapper.WbGitConfigMapper;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

class GitConfigServiceTest {

    @Test
    void encryptAndDecryptRoundTripsTokensLongerAndShorterThan32BytesWithKey() {
        String key = "unit-test-token-key";
        String classicPat40 = "ghp_1234567890abcdefghijklmnopqrstuvwxyz";
        String fineGrainedPat93 = "github_pat_" + "A".repeat(82);
        String shortToken = "glpat-short";
        String exact32 = "a".repeat(32);
        String utf8Token = "token-密钥-" + "x".repeat(30);

        for (String token : new String[]{classicPat40, fineGrainedPat93, shortToken, exact32, utf8Token}) {
            String encrypted = GitConfigService.encryptToken(token, key);
            assertThat(encrypted).isNotEqualTo(token);
            assertThat(GitConfigService.decryptToken(encrypted, key)).isEqualTo(token);
        }
    }

    @Test
    void encryptAndDecryptFallsBackToBase64WhenKeyIsBlank() {
        String token = "github_pat_" + "Z".repeat(82);
        for (String blankKey : new String[]{null, "", "   "}) {
            String encrypted = GitConfigService.encryptToken(token, blankKey);
            assertThat(GitConfigService.decryptToken(encrypted, blankKey)).isEqualTo(token);
        }
    }

    @Test
    void getConfigMasksShortAndLongTokens() {
        WbGitConfigMapper mapper = Mockito.mock(WbGitConfigMapper.class);
        GitConfigService service = new GitConfigService(mapper, null, null);
        String envKey = System.getenv("WB_DATA_GIT_TOKEN_KEY");

        WbGitConfig shortCfg = new WbGitConfig();
        shortCfg.setProjectGroupId(1L);
        shortCfg.setToken(GitConfigService.encryptToken("ab12", envKey));
        when(mapper.selectOne(any(LambdaQueryWrapper.class))).thenReturn(shortCfg);
        assertThat(service.getConfig(1L).getToken()).isEqualTo("****");

        WbGitConfig longCfg = new WbGitConfig();
        longCfg.setProjectGroupId(1L);
        longCfg.setToken(GitConfigService.encryptToken("ghp_123456", envKey));
        when(mapper.selectOne(any(LambdaQueryWrapper.class))).thenReturn(longCfg);
        assertThat(service.getConfig(1L).getToken()).isEqualTo("ghp_****");
    }
}
