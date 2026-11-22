package com.wbdata.common.crypto;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * 统一敏感字段加解密服务（AES-256-GCM），用于数据源密码与 Git PAT 落库保护，并兼容历史数据读取。
 */
@Service
public class SecretCryptoService {

    public static final String PREFIX_V1 = "enc:v1:";
    private static final String CIPHER_ALGORITHM = "AES/GCM/NoPadding";
    private static final int GCM_IV_LENGTH = 12;
    private static final int GCM_TAG_BITS = 128;
    private static final int GCM_TAG_BYTES = GCM_TAG_BITS / 8;

    private final SecretKeySpec secretKeySpec;
    private final SecureRandom secureRandom;
    private final String legacyGitTokenKey;

    @Autowired
    public SecretCryptoService(SecurityProperties properties) {
        this(
                properties != null ? properties.getSecretKey() : null,
                properties != null ? properties.getLegacyGitTokenKey() : null
        );
    }

    public SecretCryptoService(String secretKey, String legacyGitTokenKey) {
        if (secretKey == null || secretKey.isBlank()) {
            throw new IllegalStateException("wbdata.security.secret-key (WB_DATA_SECRET_KEY) 不能为空，请通过环境变量配置加密密钥");
        }
        this.secretKeySpec = new SecretKeySpec(sha256(secretKey), "AES");
        this.secureRandom = new SecureRandom();
        this.legacyGitTokenKey = legacyGitTokenKey;
    }

    public boolean isEncrypted(String value) {
        return value != null && value.startsWith(PREFIX_V1);
    }

    public String encrypt(String plaintext) {
        if (plaintext == null || plaintext.isEmpty()) {
            return plaintext;
        }
        try {
            byte[] iv = new byte[GCM_IV_LENGTH];
            secureRandom.nextBytes(iv);

            Cipher cipher = Cipher.getInstance(CIPHER_ALGORITHM);
            cipher.init(Cipher.ENCRYPT_MODE, secretKeySpec, new GCMParameterSpec(GCM_TAG_BITS, iv));
            byte[] encrypted = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));

            byte[] payload = new byte[GCM_IV_LENGTH + encrypted.length];
            System.arraycopy(iv, 0, payload, 0, GCM_IV_LENGTH);
            System.arraycopy(encrypted, 0, payload, GCM_IV_LENGTH, encrypted.length);

            return PREFIX_V1 + Base64.getEncoder().encodeToString(payload);
        } catch (GeneralSecurityException ex) {
            throw new IllegalStateException("敏感配置加密失败", ex);
        }
    }

    public String decrypt(String ciphertext) {
        if (!isEncrypted(ciphertext)) {
            throw new IllegalStateException("敏感配置解密失败，密文缺少预期前缀");
        }
        try {
            byte[] payload = Base64.getDecoder().decode(ciphertext.substring(PREFIX_V1.length()));
            if (payload.length < GCM_IV_LENGTH + GCM_TAG_BYTES) {
                throw new IllegalStateException("敏感配置解密失败，请检查 WB_DATA_SECRET_KEY 是否匹配或密文是否损坏");
            }
            byte[] iv = new byte[GCM_IV_LENGTH];
            byte[] encrypted = new byte[payload.length - GCM_IV_LENGTH];
            System.arraycopy(payload, 0, iv, 0, GCM_IV_LENGTH);
            System.arraycopy(payload, GCM_IV_LENGTH, encrypted, 0, encrypted.length);

            Cipher cipher = Cipher.getInstance(CIPHER_ALGORITHM);
            cipher.init(Cipher.DECRYPT_MODE, secretKeySpec, new GCMParameterSpec(GCM_TAG_BITS, iv));
            byte[] plaintext = cipher.doFinal(encrypted);
            return new String(plaintext, StandardCharsets.UTF_8);
        } catch (IllegalArgumentException | GeneralSecurityException ex) {
            throw new IllegalStateException("敏感配置解密失败，请检查 WB_DATA_SECRET_KEY 是否匹配或密文是否损坏", ex);
        }
    }

    /**
     * 解密数据源密码；若尚未加密则按历史明文行原样返回。
     */
    public String decryptOrPlaintext(String stored) {
        if (stored == null || stored.isEmpty()) {
            return stored;
        }
        if (isEncrypted(stored)) {
            return decrypt(stored);
        }
        return stored;
    }

    /**
     * 解密 Git Token；若非 enc:v1: 前缀则兼容历史 Base64 / SHA-256 异或密文。
     */
    public String decryptGitToken(String stored) {
        if (stored == null || stored.isEmpty()) {
            return stored;
        }
        if (isEncrypted(stored)) {
            return decrypt(stored);
        }
        return decryptLegacyGitToken(stored, legacyGitTokenKey);
    }

    public static String decryptLegacyGitToken(String encrypted, String legacyKey) {
        try {
            byte[] decoded = Base64.getDecoder().decode(encrypted);
            if (legacyKey == null || legacyKey.isBlank()) {
                return new String(decoded, StandardCharsets.UTF_8);
            }
            byte[] keyBytes = sha256(legacyKey);
            byte[] plain = new byte[decoded.length];
            for (int i = 0; i < decoded.length; i++) {
                plain[i] = (byte) (decoded[i] ^ keyBytes[i % keyBytes.length]);
            }
            return new String(plain, StandardCharsets.UTF_8);
        } catch (RuntimeException ex) {
            throw new IllegalStateException("历史 Git Token 解密失败", ex);
        }
    }

    private static byte[] sha256(String value) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 算法不可用", ex);
        }
    }
}
