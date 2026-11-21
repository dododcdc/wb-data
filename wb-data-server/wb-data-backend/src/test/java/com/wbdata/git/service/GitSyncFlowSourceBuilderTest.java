package com.wbdata.git.service;

import com.wbdata.git.entity.WbGitConfig;
import com.wbdata.git.entity.WbGitSyncConfig;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class GitSyncFlowSourceBuilderTest {

    @Test
    void buildIdentifiers_keepReadableSlugOnlyForCanonicalSlugBranches() {
        assertThat(GitSyncFlowSourceBuilder.buildKestraNamespace(4L, "main"))
                .isEqualTo("g4-main");
        assertThat(GitSyncFlowSourceBuilder.buildSyncFlowId(4L, "release-1"))
                .isEqualTo("sync-flows-g4-release-1");
    }

    @Test
    void buildIdentifiers_disambiguateLossyBranchSlugsWithHashSuffix() {
        String slash = GitSyncFlowSourceBuilder.buildKestraNamespace(4L, "feature/policy-review");
        String hyphen = GitSyncFlowSourceBuilder.buildKestraNamespace(4L, "feature-policy-review");
        String underscore = GitSyncFlowSourceBuilder.buildKestraNamespace(4L, "feature_policy_review");
        String uppercase = GitSyncFlowSourceBuilder.buildKestraNamespace(4L, "Feature/policy-review");

        assertThat(slash).matches("g4-feature-policy-review-[a-f0-9]{8}");
        assertThat(hyphen).isEqualTo("g4-feature-policy-review");
        assertThat(underscore).matches("g4-feature-policy-review-[a-f0-9]{8}");
        assertThat(uppercase).matches("g4-feature-policy-review-[a-f0-9]{8}");
        assertThat(java.util.Set.of(slash, hyphen, underscore, uppercase)).hasSize(4);

        assertThat(GitSyncFlowSourceBuilder.buildSyncFlowId(4L, "feature/policy-review"))
                .matches("sync-flows-g4-feature-policy-review-[a-f0-9]{8}");
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
        String expectedNamespace = GitSyncFlowSourceBuilder.buildKestraNamespace(4L, "feature/policy-review");
        String expectedSyncFlowId = GitSyncFlowSourceBuilder.buildSyncFlowId(4L, "feature/policy-review");

        assertThat(source)
                .contains("id: " + expectedSyncFlowId)
                .contains("namespace: system")
                .contains("concurrency:\n  limit: 1\n  behavior: QUEUE")
                .contains("type: io.wbdata.kestra.core.GitRemoteRevision")
                .contains("type: io.kestra.plugin.git.SyncFlows")
                .contains("type: io.kestra.plugin.git.SyncNamespaceFiles")
                .containsSubsequence("resolve_start", "sync_flows", "sync_files", "resolve_end", "start_sha", "end_sha")
                .contains("value: \"{{ outputs.resolve_start.sha }}\"")
                .contains("value: \"{{ outputs.resolve_end.sha }}\"")
                .contains("branch: \"feature/policy-review\"")
                .contains("targetNamespace: " + expectedNamespace)
                .contains("namespace: " + expectedNamespace)
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
        gitConfig.setToken("ghp_\"secret\"\nline2");
        gitConfig.setBaseUrl("https://git.example.com/");

        String source = GitSyncFlowSourceBuilder.buildSyncFlowSource(
                gitConfig,
                syncConfig("release/1.0:\"hotfix\"\n", false),
                "0 0 * * *"
        );

        assertThat(source)
                .contains("disabled: true")
                .contains("defaults: \"ali\\\\ce\"")
                .contains("defaults: \"ghp_\\\"secret\\\"\\nline2\"")
                .contains("branch: \"release/1.0:\\\"hotfix\\\"\\n\"")
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
