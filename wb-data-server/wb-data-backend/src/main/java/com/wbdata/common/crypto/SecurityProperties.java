package com.wbdata.common.crypto;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * 敏感配置加解密相关属性。
 */
@Component
@ConfigurationProperties(prefix = "wbdata.security")
public class SecurityProperties {

    private String secretKey;

    private String legacyGitTokenKey;

    public String getSecretKey() {
        return secretKey;
    }

    public void setSecretKey(String secretKey) {
        this.secretKey = secretKey;
    }

    public String getLegacyGitTokenKey() {
        return legacyGitTokenKey;
    }

    public void setLegacyGitTokenKey(String legacyGitTokenKey) {
        this.legacyGitTokenKey = legacyGitTokenKey;
    }
}
