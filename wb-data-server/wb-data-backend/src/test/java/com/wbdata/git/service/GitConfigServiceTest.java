package com.wbdata.git.service;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

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
}
