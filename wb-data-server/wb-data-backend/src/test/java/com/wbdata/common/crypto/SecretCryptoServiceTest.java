package com.wbdata.common.crypto;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SecretCryptoServiceTest {

    @Test
    void constructor_failsFastWhenSecretKeyIsBlank() {
        for (String blankKey : new String[]{null, "", "   "}) {
            assertThatThrownBy(() -> new SecretCryptoService(blankKey, null))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("WB_DATA_SECRET_KEY");
        }
    }

    @Test
    void encryptAndDecrypt_roundTripsWithRandomIv() {
        SecretCryptoService service = new SecretCryptoService("unit-test-master-key", null);
        String[] samples = {
                "p@ssw0rd!",
                "密钥-中文-p@ss$",
                "a",
                "github_pat_" + "A".repeat(120)
        };

        for (String sample : samples) {
            String first = service.encrypt(sample);
            String second = service.encrypt(sample);

            assertThat(first).startsWith(SecretCryptoService.PREFIX_V1);
            assertThat(second).startsWith(SecretCryptoService.PREFIX_V1);
            assertThat(first).isNotEqualTo(second);
            assertThat(service.decrypt(first)).isEqualTo(sample);
            assertThat(service.decrypt(second)).isEqualTo(sample);
        }
    }

    @Test
    void encryptAndDecrypt_passesThroughNullAndEmpty() {
        SecretCryptoService service = new SecretCryptoService("unit-test-master-key", null);

        assertThat(service.encrypt(null)).isNull();
        assertThat(service.encrypt("")).isEmpty();
        assertThat(service.decryptOrPlaintext(null)).isNull();
        assertThat(service.decryptOrPlaintext("")).isEmpty();
        assertThat(service.decryptGitToken(null)).isNull();
        assertThat(service.decryptGitToken("")).isEmpty();
    }

    @Test
    void decrypt_rejectsTamperedCiphertextOrWrongKey() {
        SecretCryptoService service = new SecretCryptoService("unit-test-master-key", null);
        SecretCryptoService otherKeyService = new SecretCryptoService("different-master-key", null);

        String ciphertext = service.encrypt("top-secret-password");
        byte[] rawPayload = Base64.getDecoder().decode(ciphertext.substring(SecretCryptoService.PREFIX_V1.length()));
        rawPayload[rawPayload.length - 1] ^= 0x01;
        String tampered = SecretCryptoService.PREFIX_V1 + Base64.getEncoder().encodeToString(rawPayload);

        assertThatThrownBy(() -> service.decrypt(tampered))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("WB_DATA_SECRET_KEY");

        assertThatThrownBy(() -> otherKeyService.decrypt(ciphertext))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("WB_DATA_SECRET_KEY");

        assertThatThrownBy(() -> service.decrypt("not-prefixed"))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void decryptOrPlaintext_supportsLegacyPlaintextAndEncryptedRows() {
        SecretCryptoService service = new SecretCryptoService("unit-test-master-key", null);
        String encrypted = service.encrypt("db-secret-123");

        assertThat(service.decryptOrPlaintext(encrypted)).isEqualTo("db-secret-123");
        assertThat(service.decryptOrPlaintext("legacy-plain-password")).isEqualTo("legacy-plain-password");
    }

    @Test
    void decryptGitToken_supportsV1AndLegacyBase64AndLegacyXor() throws Exception {
        String token = "github_pat_" + "Z".repeat(82);

        SecretCryptoService blankLegacyService = new SecretCryptoService("unit-test-master-key", null);
        String legacyBase64 = Base64.getEncoder().encodeToString(token.getBytes(StandardCharsets.UTF_8));
        assertThat(blankLegacyService.decryptGitToken(legacyBase64)).isEqualTo(token);
        assertThat(blankLegacyService.decryptGitToken(blankLegacyService.encrypt(token))).isEqualTo(token);

        String legacyKey = "legacy-xor-key";
        SecretCryptoService xorLegacyService = new SecretCryptoService("unit-test-master-key", legacyKey);
        String legacyXor = legacyXorEncrypt(token, legacyKey);
        assertThat(xorLegacyService.decryptGitToken(legacyXor)).isEqualTo(token);
        assertThat(xorLegacyService.decryptGitToken(xorLegacyService.encrypt(token))).isEqualTo(token);
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
