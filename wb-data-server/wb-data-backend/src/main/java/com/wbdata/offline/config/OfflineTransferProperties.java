package com.wbdata.offline.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "wbdata.offline.transfer")
public class OfflineTransferProperties {
    private String seatunnelImage = "apache/seatunnel:2.3.13";
    private String dockerNetwork = "wb-data-integration";
    private String internalBaseUrlEnv = "WB_DATA_INTERNAL_BASE_URL";
    private String internalTokenEnv = "WB_DATA_INTERNAL_TOKEN";

    public String getSeatunnelImage() {
        return seatunnelImage;
    }

    public void setSeatunnelImage(String seatunnelImage) {
        this.seatunnelImage = seatunnelImage;
    }

    public String getDockerNetwork() {
        return dockerNetwork;
    }

    public void setDockerNetwork(String dockerNetwork) {
        this.dockerNetwork = dockerNetwork;
    }

    public String getInternalBaseUrlEnv() {
        return internalBaseUrlEnv;
    }

    public void setInternalBaseUrlEnv(String internalBaseUrlEnv) {
        this.internalBaseUrlEnv = internalBaseUrlEnv;
    }

    public String getInternalTokenEnv() {
        return internalTokenEnv;
    }

    public void setInternalTokenEnv(String internalTokenEnv) {
        this.internalTokenEnv = internalTokenEnv;
    }
}
