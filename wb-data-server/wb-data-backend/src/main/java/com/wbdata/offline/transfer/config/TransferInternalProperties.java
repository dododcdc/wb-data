package com.wbdata.offline.transfer.config;

import jakarta.validation.constraints.Min;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;
import org.springframework.validation.annotation.Validated;

@Component
@Validated
@ConfigurationProperties(prefix = "wbdata.offline.transfer")
public class TransferInternalProperties {

    private String internalToken;
    @Min(1)
    private int sqlTimeoutSeconds = 300;

    public int getSqlTimeoutSeconds() {
        return sqlTimeoutSeconds;
    }

    public void setSqlTimeoutSeconds(int sqlTimeoutSeconds) {
        this.sqlTimeoutSeconds = sqlTimeoutSeconds;
    }

    public String getInternalToken() {
        return internalToken;
    }

    public void setInternalToken(String internalToken) {
        this.internalToken = internalToken;
    }
}
