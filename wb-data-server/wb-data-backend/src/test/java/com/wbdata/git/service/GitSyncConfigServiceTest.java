package com.wbdata.git.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.wbdata.git.dto.AddAllGitSyncConfigsResponse;
import com.wbdata.git.dto.GitSyncConfigResponse;
import com.wbdata.git.entity.WbGitConfig;
import com.wbdata.git.entity.WbGitSyncConfig;
import com.wbdata.git.mapper.WbGitSyncConfigMapper;
import com.wbdata.offline.config.OfflineKestraProperties;
import com.wbdata.offline.dto.BranchItemResponse;
import com.wbdata.offline.dto.BranchListResponse;
import com.wbdata.offline.service.GitCommandService;
import com.wbdata.offline.service.KestraClient;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class GitSyncConfigServiceTest {

    @Test
    void buildNamespace_usesReadableBranchSlugForNormalBranch() {
        GitSyncConfigService service = service();

        assertThat(service.buildKestraNamespace(4L, "feature/policy-review"))
                .isEqualTo("g4-feature-policy-review");
        assertThat(service.buildSyncFlowId(4L, "feature/policy-review"))
                .isEqualTo("sync-flows-g4-feature-policy-review");
    }

    @Test
    void buildNamespace_truncatesLongBranchWithHashSuffix() {
        GitSyncConfigService service = service();
        String branch = "feature/" + "very-long-policy-branch-".repeat(12);

        String namespace = service.buildKestraNamespace(Long.MAX_VALUE, branch);

        assertThat(namespace).startsWith("g" + Long.MAX_VALUE + "-feature-very-long-policy-branch");
        assertThat(namespace).matches("g" + Long.MAX_VALUE + "-.*-[a-f0-9]{8}");
        assertThat(namespace.length()).isLessThanOrEqualTo(150);
    }

    @Test
    void create_upsertsSyncFlowYamlForBranch() {
        WbGitSyncConfigMapper mapper = Mockito.mock(WbGitSyncConfigMapper.class);
        GitConfigService gitConfigService = Mockito.mock(GitConfigService.class);
        GitCommandService gitCommandService = Mockito.mock(GitCommandService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        GitSyncConfigService service = service(mapper, gitConfigService, gitCommandService, kestraClient);

        when(gitConfigService.requireDecryptedConfig(4L)).thenReturn(gitConfig(99L));
        when(gitCommandService.listBranches(4L)).thenReturn(new BranchListResponse(List.of(
                new BranchItemResponse("main", true, true, true, "origin/main", "origin/main"),
                new BranchItemResponse("feature/policy-review", false, true, false, null, null)
        )));
        when(mapper.selectOne(any(LambdaQueryWrapper.class))).thenReturn(null);
        doAnswer(invocation -> {
            WbGitSyncConfig entity = invocation.getArgument(0);
            entity.setId(12L);
            return 1;
        }).when(mapper).insert(any(WbGitSyncConfig.class));

        GitSyncConfigResponse response = service.create(4L, "feature/policy-review");

        assertThat(response.branch()).isEqualTo("feature/policy-review");
        assertThat(response.namespace()).isEqualTo("g4-feature-policy-review");
        assertThat(response.syncFlowId()).isEqualTo("sync-flows-g4-feature-policy-review");

        ArgumentCaptor<String> source = ArgumentCaptor.forClass(String.class);
        verify(kestraClient).upsertFlow(source.capture());
        assertThat(source.getValue())
                .contains("id: sync-flows-g4-feature-policy-review")
                .contains("namespace: system")
                .contains("type: io.kestra.plugin.git.SyncFlows")
                .contains("type: io.kestra.plugin.git.SyncNamespaceFiles")
                .contains("- id: git_token\n    type: STRING")
                .contains("branch: feature/policy-review")
                .contains("targetNamespace: g4-feature-policy-review")
                .contains("namespace: g4-feature-policy-review")
                .contains("gitDirectory: _flows")
                .contains("gitDirectory: .")
                .contains("cron: \"*/5 * * * *\"")
                .contains("defaults: \"alice\"")
                .contains("defaults: \"ghp_secret\"");
    }

    @Test
    void createAllKnownBranches_skipsExistingAndCreatesMissingBranches() {
        WbGitSyncConfigMapper mapper = Mockito.mock(WbGitSyncConfigMapper.class);
        GitConfigService gitConfigService = Mockito.mock(GitConfigService.class);
        GitCommandService gitCommandService = Mockito.mock(GitCommandService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        GitSyncConfigService service = service(mapper, gitConfigService, gitCommandService, kestraClient);

        when(gitConfigService.requireDecryptedConfig(4L)).thenReturn(gitConfig(99L));
        when(gitCommandService.listBranches(4L)).thenReturn(new BranchListResponse(List.of(
                new BranchItemResponse("main", true, true, true, "origin/main", "origin/main"),
                new BranchItemResponse("feature/policy-review", false, true, false, null, null),
                new BranchItemResponse("feature/policy-etl", false, true, false, null, null)
        )));
        when(mapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of(existing("main")));
        when(mapper.selectOne(any(LambdaQueryWrapper.class))).thenReturn(null);
        doAnswer(invocation -> {
            WbGitSyncConfig entity = invocation.getArgument(0);
            entity.setId(20L);
            return 1;
        }).when(mapper).insert(any(WbGitSyncConfig.class));

        AddAllGitSyncConfigsResponse response = service.createAllKnownBranches(4L);

        assertThat(response.created()).isEqualTo(2);
        assertThat(response.existing()).isEqualTo(1);
        verify(kestraClient, Mockito.times(3)).upsertFlow(any(String.class));
        verify(mapper).updateById(any(WbGitSyncConfig.class));
    }

    @Test
    void create_doesNotInsertConfigWhenKestraUpsertFails() {
        WbGitSyncConfigMapper mapper = Mockito.mock(WbGitSyncConfigMapper.class);
        GitConfigService gitConfigService = Mockito.mock(GitConfigService.class);
        GitCommandService gitCommandService = Mockito.mock(GitCommandService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        GitSyncConfigService service = service(mapper, gitConfigService, gitCommandService, kestraClient);

        when(gitConfigService.requireDecryptedConfig(4L)).thenReturn(gitConfig(99L));
        when(gitCommandService.listBranches(4L)).thenReturn(new BranchListResponse(List.of(
                new BranchItemResponse("feature/policy-review", false, true, false, null, null)
        )));
        when(mapper.selectOne(any(LambdaQueryWrapper.class))).thenReturn(null);
        doThrow(new RuntimeException("Kestra rejected flow")).when(kestraClient).upsertFlow(any(String.class));

        assertThatThrownBy(() -> service.create(4L, "feature/policy-review"))
                .isInstanceOf(RuntimeException.class)
                .hasMessage("Kestra rejected flow");
        verify(mapper, never()).insert(any(WbGitSyncConfig.class));
    }

    private GitSyncConfigService service() {
        return service(
                Mockito.mock(WbGitSyncConfigMapper.class),
                Mockito.mock(GitConfigService.class),
                Mockito.mock(GitCommandService.class),
                Mockito.mock(KestraClient.class)
        );
    }

    private GitSyncConfigService service(WbGitSyncConfigMapper mapper,
                                         GitConfigService gitConfigService,
                                         GitCommandService gitCommandService,
                                         KestraClient kestraClient) {
        OfflineKestraProperties kestraProperties = new OfflineKestraProperties();
        GitSyncProperties syncProperties = new GitSyncProperties();
        syncProperties.setSyncCron("*/5 * * * *");
        return new GitSyncConfigService(mapper, gitConfigService, gitCommandService, kestraClient, kestraProperties, syncProperties);
    }

    private WbGitConfig gitConfig(Long id) {
        WbGitConfig config = new WbGitConfig();
        config.setId(id);
        config.setProjectGroupId(4L);
        config.setProvider("github");
        config.setUsername("alice");
        config.setToken("ghp_secret");
        config.setBaseUrl("https://github.com");
        return config;
    }

    private WbGitSyncConfig existing(String branch) {
        WbGitSyncConfig config = new WbGitSyncConfig();
        config.setId(10L);
        config.setGroupId(4L);
        config.setGitConfigId(99L);
        config.setBranch(branch);
        config.setEnabled(true);
        return config;
    }
}
