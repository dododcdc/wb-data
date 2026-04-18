package com.wbdata.offline.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "wbdata.offline.kestra")
public class OfflineKestraProperties {

    private String baseUrl = "http://localhost:8090";
    private String tenant = "main";
    private String username;
    private String password;
    private String debugNamespacePrefix = "wb-debug-g";

    public String getBaseUrl() {
        return baseUrl;
    }

    public void setBaseUrl(String baseUrl) {
        this.baseUrl = baseUrl;
    }

    public String getTenant() {
        return tenant;
    }

    public void setTenant(String tenant) {
        this.tenant = tenant;
    }

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public String getPassword() {
        return password;
    }

    public void setPassword(String password) {
        this.password = password;
    }

    public String getDebugNamespacePrefix() {
        return debugNamespacePrefix;
    }

    public void setDebugNamespacePrefix(String debugNamespacePrefix) {
        this.debugNamespacePrefix = debugNamespacePrefix;
    }

    public String buildDebugNamespace(Long groupId, Long userId) {
        return debugNamespacePrefix + groupId + "-u" + userId;
    }
}
