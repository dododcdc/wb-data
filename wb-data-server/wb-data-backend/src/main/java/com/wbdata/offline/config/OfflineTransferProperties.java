package com.wbdata.offline.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

@Component
@ConfigurationProperties(prefix = "wbdata.offline.transfer")
public class OfflineTransferProperties {
    public static final String DEFAULT_SEATUNNEL_IMAGE = "wb-data-seatunnel:2.3.13";
    public static final String DEFAULT_SEATUNNEL_HOME = "/opt/seatunnel";

    private TransferRunner runner = TransferRunner.DOCKER;
    private String seatunnelImage = DEFAULT_SEATUNNEL_IMAGE;
    private String seatunnelHome = DEFAULT_SEATUNNEL_HOME;
    private String dockerNetwork = "wb-data_default";
    private String internalBaseUrlEnv = "WB_DATA_INTERNAL_BASE_URL";
    private String internalTokenEnv = "WB_DATA_INTERNAL_TOKEN";
    private String internalBaseUrl;
    private String internalToken;
    private String containerHostRewrite = "";
    private List<String> dockerVolumes = new ArrayList<>();

    public String getContainerHostRewrite() {
        return containerHostRewrite;
    }

    public void setContainerHostRewrite(String containerHostRewrite) {
        this.containerHostRewrite = containerHostRewrite == null ? "" : containerHostRewrite;
    }

    public TransferRunner getRunner() {
        return runner == null ? TransferRunner.DOCKER : runner;
    }

    public void setRunner(TransferRunner runner) {
        this.runner = runner == null ? TransferRunner.DOCKER : runner;
    }

    public String getSeatunnelHome() {
        return seatunnelHome == null || seatunnelHome.isBlank() ? DEFAULT_SEATUNNEL_HOME : seatunnelHome;
    }

    public void setSeatunnelHome(String seatunnelHome) {
        this.seatunnelHome = seatunnelHome == null || seatunnelHome.isBlank()
                ? DEFAULT_SEATUNNEL_HOME
                : seatunnelHome;
    }

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

    public String getInternalBaseUrl() {
        return internalBaseUrl;
    }

    public void setInternalBaseUrl(String internalBaseUrl) {
        this.internalBaseUrl = internalBaseUrl;
    }

    public String getInternalToken() {
        return internalToken;
    }

    public void setInternalToken(String internalToken) {
        this.internalToken = internalToken;
    }

    public List<String> getDockerVolumes() {
        return dockerVolumes;
    }

    public void setDockerVolumes(List<String> dockerVolumes) {
        this.dockerVolumes = dockerVolumes == null ? new ArrayList<>() : dockerVolumes;
    }
}
