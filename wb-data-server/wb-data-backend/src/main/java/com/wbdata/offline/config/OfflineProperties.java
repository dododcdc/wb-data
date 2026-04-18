package com.wbdata.offline.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.nio.file.Path;

@Component
@ConfigurationProperties(prefix = "wbdata.offline")
public class OfflineProperties {

    private String repoBaseDir = "/data/repos";
    private String repoDirPrefix = "wb-data-";

    public String getRepoBaseDir() {
        return repoBaseDir;
    }

    public void setRepoBaseDir(String repoBaseDir) {
        this.repoBaseDir = repoBaseDir;
    }

    public String getRepoDirPrefix() {
        return repoDirPrefix;
    }

    public void setRepoDirPrefix(String repoDirPrefix) {
        this.repoDirPrefix = repoDirPrefix;
    }

    public Path resolveRepoPath(Long groupId) {
        return Path.of(repoBaseDir, repoDirPrefix + groupId).toAbsolutePath().normalize();
    }
}
