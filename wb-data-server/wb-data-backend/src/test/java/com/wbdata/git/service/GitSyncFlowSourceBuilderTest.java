package com.wbdata.git.service;

import com.wbdata.git.entity.WbGitConfig;
import com.wbdata.git.entity.WbGitSyncConfig;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class GitSyncFlowSourceBuilderTest {

    @Test
    void buildIdentifiers_useReadableBranchSlugForNormalBranch() {
        assertThat(GitSyncFlowSourceBuilder.buildKestraNamespace(4L, "feature/policy-review"))
                .isEqualTo("g4-feature-policy-review");
        assertThat(GitSyncFlowSourceBuilder.buildSyncFlowId(4L, "feature/policy-review"))
                .isEqualTo("sync-flows-g4-feature-policy-review");
    }

    @Test
    void buildIdentifiers_truncateLongBranchWithHashSuffix() {
        String branch = "feature/" + "very-long-policy-branch-".repeat(12);

        String namespace = GitSyncFlowSourceBuilder.buildKestraNamespace(Long.MAX_VALUE, branch);

        assertThat(namespace).startsWith("g" + Long.MAX_VALUE + "-feature-very-long-policy-branch");
        assertThat(namespace).matches("g" + Long.MAX_VALUE + "-.*-[a-f0-9]{8}");
        assertThat(namespace.length()).isLessThanOrEqualTo(150);
    }

    @Test
    void buildSyncFlowSource_includesGitSyncFlowAndNamespaceFileTasks() {
        String source = GitSyncFlowSourceBuilder.buildSyncFlowSource(
                gitConfig(),
                syncConfig("feature/policy-review", true),
                "*/5 * * * *"
        );

        assertThat(source)
                .contains("id: sync-flows-g4-feature-policy-review")
                .contains("namespace: system")
                .contains("type: io.kestra.plugin.git.SyncFlows")
                .contains("type: io.kestra.plugin.git.SyncNamespaceFiles")
                .contains("branch: feature/policy-review")
                .contains("targetNamespace: g4-feature-policy-review")
                .contains("namespace: g4-feature-policy-review")
                .contains("gitDirectory: .wb-data/kestra-flows")
                .contains("gitDirectory: .\n    delete: true")
                .contains("cron: \"*/5 * * * *\"")
                .contains("disabled: false")
                .contains("defaults: \"alice\"")
                .contains("defaults: \"ghp_secret\"")
                .contains("url: \"https://github.com/alice/wb-data-4.git\"");
    }

    @Test
    void buildSyncFlowSource_escapesDoubleQuotedYamlValues() {
        WbGitConfig gitConfig = gitConfig();
        gitConfig.setUsername("ali\\ce");
        gitConfig.setToken("ghp_\"secret\"");
        gitConfig.setBaseUrl("https://git.example.com/");

        String source = GitSyncFlowSourceBuilder.buildSyncFlowSource(
                gitConfig,
                syncConfig("release/main", false),
                "0 0 * * *"
        );

        assertThat(source)
                .contains("disabled: true")
                .contains("defaults: \"ali\\\\ce\"")
                .contains("defaults: \"ghp_\\\"secret\\\"\"")
                .contains("url: \"https://git.example.com/ali\\\\ce/wb-data-4.git\"");
    }

    private WbGitConfig gitConfig() {
        WbGitConfig config = new WbGitConfig();
        config.setId(99L);
        config.setProjectGroupId(4L);
        config.setProvider("github");
        config.setUsername("alice");
        config.setToken("ghp_secret");
        config.setBaseUrl("https://github.com");
        return config;
    }

    private WbGitSyncConfig syncConfig(String branch, boolean enabled) {
        WbGitSyncConfig config = new WbGitSyncConfig();
        config.setId(10L);
        config.setGroupId(4L);
        config.setGitConfigId(99L);
        config.setBranch(branch);
        config.setEnabled(enabled);
        return config;
    }
}
