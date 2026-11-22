package com.wbdata.git.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.wbdata.common.crypto.SecretCryptoService;
import com.wbdata.git.entity.WbGitConfig;
import com.wbdata.git.mapper.WbGitConfigMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class GitConfigServiceTest {

    @Test
    void saveAndRequireDecryptedConfig_roundTripsTokensWithAesGcm() {
        WbGitConfigMapper mapper = Mockito.mock(WbGitConfigMapper.class);
        SecretCryptoService cryptoService = new SecretCryptoService("unit-test-secret-key", null);
        GitConfigService service = new GitConfigService(mapper, null, null, cryptoService);

        String[] tokens = {
                "ghp_1234567890abcdefghijklmnopqrstuvwxyz",
                "github_pat_" + "A".repeat(82),
                "glpat-short",
                "a".repeat(32),
                "token-密钥-" + "x".repeat(30)
        };

        for (String token : tokens) {
            Mockito.reset(mapper);
            when(mapper.selectOne(any(LambdaQueryWrapper.class))).thenReturn(null);

            service.saveConfig(1L, "github", "alice", token, null, 9L);

            ArgumentCaptor<WbGitConfig> captor = ArgumentCaptor.forClass(WbGitConfig.class);
            verify(mapper).insert(captor.capture());
            String storedCiphertext = captor.getValue().getToken();
            assertThat(storedCiphertext).startsWith(SecretCryptoService.PREFIX_V1);
            assertThat(storedCiphertext).doesNotContain(token);

            WbGitConfig stored = new WbGitConfig();
            stored.setId(10L);
            stored.setProjectGroupId(1L);
            stored.setToken(storedCiphertext);
            when(mapper.selectOne(any(LambdaQueryWrapper.class))).thenReturn(stored);

            assertThat(service.requireDecryptedConfig(1L).getToken()).isEqualTo(token);
        }
    }

    @Test
    void loadConfig_supportsLegacyBase64AndLegacyXorTokens() throws Exception {
        String token = "github_pat_" + "Z".repeat(82);

        WbGitConfigMapper base64Mapper = Mockito.mock(WbGitConfigMapper.class);
        GitConfigService base64Service = new GitConfigService(
                base64Mapper, null, null, new SecretCryptoService("unit-test-secret-key", null));
        WbGitConfig legacyBase64Row = new WbGitConfig();
        legacyBase64Row.setProjectGroupId(1L);
        legacyBase64Row.setToken(Base64.getEncoder().encodeToString(token.getBytes(StandardCharsets.UTF_8)));
        when(base64Mapper.selectOne(any(LambdaQueryWrapper.class))).thenReturn(legacyBase64Row);

        assertThat(base64Service.requireDecryptedConfig(1L).getToken()).isEqualTo(token);

        String legacyKey = "legacy-unit-key";
        WbGitConfigMapper xorMapper = Mockito.mock(WbGitConfigMapper.class);
        GitConfigService xorService = new GitConfigService(
                xorMapper, null, null, new SecretCryptoService("unit-test-secret-key", legacyKey));
        WbGitConfig legacyXorRow = new WbGitConfig();
        legacyXorRow.setProjectGroupId(1L);
        legacyXorRow.setToken(legacyXorEncrypt(token, legacyKey));
        when(xorMapper.selectOne(any(LambdaQueryWrapper.class))).thenReturn(legacyXorRow);

        assertThat(xorService.requireDecryptedConfig(1L).getToken()).isEqualTo(token);
    }

    @Test
    void saveConfig_blankTokenPreservesV1CiphertextAndUpgradesLegacyToken() throws Exception {
        SecretCryptoService cryptoService = new SecretCryptoService("unit-test-secret-key", "legacy-key");

        WbGitConfigMapper v1Mapper = Mockito.mock(WbGitConfigMapper.class);
        GitConfigService v1Service = new GitConfigService(v1Mapper, null, null, cryptoService);
        String existingV1 = cryptoService.encrypt("ghp_existing_v1");
        WbGitConfig existingV1Row = new WbGitConfig();
        existingV1Row.setId(5L);
        existingV1Row.setProjectGroupId(1L);
        existingV1Row.setToken(existingV1);
        when(v1Mapper.selectOne(any(LambdaQueryWrapper.class))).thenReturn(existingV1Row);

        v1Service.saveConfig(1L, "github", "alice", "", null, 9L);

        ArgumentCaptor<WbGitConfig> v1Captor = ArgumentCaptor.forClass(WbGitConfig.class);
        verify(v1Mapper).updateById(v1Captor.capture());
        assertThat(v1Captor.getValue().getToken()).isEqualTo(existingV1);

        WbGitConfigMapper legacyMapper = Mockito.mock(WbGitConfigMapper.class);
        GitConfigService legacyService = new GitConfigService(legacyMapper, null, null, cryptoService);
        WbGitConfig legacyRow = new WbGitConfig();
        legacyRow.setId(6L);
        legacyRow.setProjectGroupId(1L);
        legacyRow.setToken(legacyXorEncrypt("ghp_legacy_plain", "legacy-key"));
        when(legacyMapper.selectOne(any(LambdaQueryWrapper.class))).thenReturn(legacyRow);

        legacyService.saveConfig(1L, "github", "alice", "   ", null, 9L);

        ArgumentCaptor<WbGitConfig> upgradedCaptor = ArgumentCaptor.forClass(WbGitConfig.class);
        verify(legacyMapper).updateById(upgradedCaptor.capture());
        String upgradedCiphertext = upgradedCaptor.getValue().getToken();
        assertThat(upgradedCiphertext).startsWith(SecretCryptoService.PREFIX_V1);
        assertThat(cryptoService.decrypt(upgradedCiphertext)).isEqualTo("ghp_legacy_plain");
    }

    @Test
    void getConfigMasksShortAndLongTokens() {
        WbGitConfigMapper mapper = Mockito.mock(WbGitConfigMapper.class);
        SecretCryptoService cryptoService = new SecretCryptoService("unit-test-secret-key", null);
        GitConfigService service = new GitConfigService(mapper, null, null, cryptoService);

        WbGitConfig shortCfg = new WbGitConfig();
        shortCfg.setProjectGroupId(1L);
        shortCfg.setToken(cryptoService.encrypt("ab12"));
        when(mapper.selectOne(any(LambdaQueryWrapper.class))).thenReturn(shortCfg);
        assertThat(service.getConfig(1L).getToken()).isEqualTo("****");

        WbGitConfig longCfg = new WbGitConfig();
        longCfg.setProjectGroupId(1L);
        longCfg.setToken(cryptoService.encrypt("ghp_123456"));
        when(mapper.selectOne(any(LambdaQueryWrapper.class))).thenReturn(longCfg);
        assertThat(service.getConfig(1L).getToken()).isEqualTo("ghp_****");
    }

    private static String legacyXorEncrypt(String token, String key) throws Exception {
        byte[] keyBytes = MessageDigest.getInstance("SHA-256").digest(key.getBytes(StandardCharsets.UTF_8));
        byte[] input = token.getBytes(StandardCharsets.UTF_8);
        byte[] cipher = new byte[input.length];
        for (int i = 0; i < input.length; i++) {
            cipher[i] = (byte) (input[i] ^ keyBytes[i % keyBytes.length]);
        }
        return Base64.getEncoder().encodeToString(cipher);
    }
}
