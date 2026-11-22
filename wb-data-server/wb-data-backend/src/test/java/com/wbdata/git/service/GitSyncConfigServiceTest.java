package com.wbdata.git.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.ISqlSegment;
import com.baomidou.mybatisplus.core.enums.SqlKeyword;
import com.wbdata.git.dto.AddAllGitSyncConfigsResponse;
import com.wbdata.git.dto.GitSyncConfigListResponse;
import com.wbdata.git.dto.GitSyncConfigResponse;
import com.wbdata.git.dto.TriggerGitSyncResponse;
import com.wbdata.git.entity.WbGitConfig;
import com.wbdata.git.entity.WbGitSyncConfig;
import com.wbdata.git.mapper.WbGitSyncConfigMapper;
import com.wbdata.offline.config.OfflineKestraProperties;
import com.wbdata.offline.config.OfflineTransferProperties;
import com.wbdata.offline.repo.service.GitCommandService;
import com.wbdata.offline.kestra.KestraClient;
import com.wbdata.offline.kestra.KestraExecutionSnapshot;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.Mockito;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class GitSyncConfigServiceTest {

    @Test
    void list_usesOnlyRefreshedRemoteBranchNames() {
        WbGitSyncConfigMapper mapper = Mockito.mock(WbGitSyncConfigMapper.class);
        GitConfigService gitConfigService = Mockito.mock(GitConfigService.class);
        GitCommandService gitCommandService = Mockito.mock(GitCommandService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        GitSyncConfigService service = service(mapper, gitConfigService, gitCommandService, kestraClient);

        when(mapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of());
        when(gitCommandService.listRemoteBranchNames(4L)).thenReturn(List.of("feature/remote-only", "main"));

        GitSyncConfigListResponse response = service.list(4L);

        assertThat(response.availableBranches()).containsExactly("feature/remote-only", "main");
        verify(gitCommandService, never()).listBranches(4L);
    }

    @Test
    void create_upsertsSyncFlowYamlForBranch() {
        WbGitSyncConfigMapper mapper = Mockito.mock(WbGitSyncConfigMapper.class);
        GitConfigService gitConfigService = Mockito.mock(GitConfigService.class);
        GitCommandService gitCommandService = Mockito.mock(GitCommandService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        GitSyncConfigService service = service(mapper, gitConfigService, gitCommandService, kestraClient);

        when(gitConfigService.requireDecryptedConfig(4L)).thenReturn(gitConfig(99L));
        when(gitCommandService.listRemoteBranchNames(4L)).thenReturn(List.of(
                "main",
                "feature/policy-review"
        ));
        when(mapper.selectOne(any(LambdaQueryWrapper.class))).thenReturn(null);
        doAnswer(invocation -> {
            WbGitSyncConfig entity = invocation.getArgument(0);
            entity.setId(12L);
            return 1;
        }).when(mapper).insert(any(WbGitSyncConfig.class));

        GitSyncConfigResponse response = service.create(4L, "feature/policy-review");

        assertThat(response.branch()).isEqualTo("feature/policy-review");
        assertThat(response.namespace())
                .isEqualTo(GitSyncFlowSourceBuilder.buildKestraNamespace(4L, "feature/policy-review"))
                .matches("g4-feature-policy-review-[a-f0-9]{8}");
        assertThat(response.syncFlowId())
                .isEqualTo(GitSyncFlowSourceBuilder.buildSyncFlowId(4L, "feature/policy-review"))
                .matches("sync-flows-g4-feature-policy-review-[a-f0-9]{8}");

        ArgumentCaptor<String> source = ArgumentCaptor.forClass(String.class);
        verify(kestraClient).upsertFlow(source.capture());
        assertThat(source.getValue()).isEqualTo(GitSyncFlowSourceBuilder.buildSyncFlowSource(
                existing("feature/policy-review"),
                "*/5 * * * *",
                null,
                "WB_DATA_INTERNAL_TOKEN"
        ));
    }

    @Test
    void createAllKnownBranches_skipsExistingAndCreatesMissingBranches() {
        WbGitSyncConfigMapper mapper = Mockito.mock(WbGitSyncConfigMapper.class);
        GitConfigService gitConfigService = Mockito.mock(GitConfigService.class);
        GitCommandService gitCommandService = Mockito.mock(GitCommandService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        GitSyncConfigService service = service(mapper, gitConfigService, gitCommandService, kestraClient);

        when(gitConfigService.requireDecryptedConfig(4L)).thenReturn(gitConfig(99L));
        when(gitCommandService.listRemoteBranchNames(4L)).thenReturn(List.of(
                "main",
                "feature/policy-review",
                "feature/policy-etl"
        ));
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
    void listEnabledSyncConfigs_returnsOnlyEnabledConfigsWithoutBranchLookup() {
        WbGitSyncConfigMapper mapper = Mockito.mock(WbGitSyncConfigMapper.class);
        GitConfigService gitConfigService = Mockito.mock(GitConfigService.class);
        GitCommandService gitCommandService = Mockito.mock(GitCommandService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        GitSyncConfigService service = service(mapper, gitConfigService, gitCommandService, kestraClient);

        WbGitSyncConfig enabled = existing("feature/policy-review");
        enabled.setId(11L);
        enabled.setEnabled(true);
        when(mapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of(enabled));

        List<GitSyncConfigResponse> configs = service.listEnabledSyncConfigs(4L);

        assertThat(configs).extracting(GitSyncConfigResponse::branch)
                .containsExactly("feature/policy-review");
        assertThat(configs.get(0).namespace())
                .isEqualTo(GitSyncFlowSourceBuilder.buildKestraNamespace(4L, "feature/policy-review"));
        @SuppressWarnings({"rawtypes", "unchecked"})
        ArgumentCaptor<LambdaQueryWrapper<WbGitSyncConfig>> query = ArgumentCaptor.forClass((Class) LambdaQueryWrapper.class);
        verify(mapper).selectList(query.capture());
        List<ISqlSegment> normalSegments = query.getValue().getExpression().getNormal();
        assertThat(normalSegments)
                .filteredOn(segment -> segment == SqlKeyword.EQ)
                .hasSize(2);
        assertThat(normalSegments)
                .filteredOn(segment -> segment == SqlKeyword.AND)
                .hasSize(1);
        assertThat(query.getValue().getExpression().getOrderBy()).hasSize(1);
        materializeConditionValueSegments(normalSegments);
        assertThat(query.getValue().getParamNameValuePairs().values())
                .contains(4L, true);
        verify(gitCommandService, never()).listRemoteBranchNames(4L);
    }

    @Test
    void create_doesNotInsertConfigWhenKestraUpsertFails() {
        WbGitSyncConfigMapper mapper = Mockito.mock(WbGitSyncConfigMapper.class);
        GitConfigService gitConfigService = Mockito.mock(GitConfigService.class);
        GitCommandService gitCommandService = Mockito.mock(GitCommandService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        GitSyncConfigService service = service(mapper, gitConfigService, gitCommandService, kestraClient);

        when(gitConfigService.requireDecryptedConfig(4L)).thenReturn(gitConfig(99L));
        when(gitCommandService.listRemoteBranchNames(4L)).thenReturn(List.of("feature/policy-review"));
        when(mapper.selectOne(any(LambdaQueryWrapper.class))).thenReturn(null);
        doThrow(new RuntimeException("Kestra rejected flow")).when(kestraClient).upsertFlow(any(String.class));

        assertThatThrownBy(() -> service.create(4L, "feature/policy-review"))
                .isInstanceOf(RuntimeException.class)
                .hasMessage("Kestra rejected flow");
        verify(mapper, never()).insert(any(WbGitSyncConfig.class));
    }

    @Test
    void setEnabled_upsertsSyncFlowBeforeUpdatingDatabase() {
        WbGitSyncConfigMapper mapper = Mockito.mock(WbGitSyncConfigMapper.class);
        GitConfigService gitConfigService = Mockito.mock(GitConfigService.class);
        GitCommandService gitCommandService = Mockito.mock(GitCommandService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        GitSyncConfigService service = service(mapper, gitConfigService, gitCommandService, kestraClient);

        WbGitSyncConfig config = existing("feature/policy-review");
        when(mapper.selectById(10L)).thenReturn(config);
        when(gitConfigService.requireDecryptedConfig(4L)).thenReturn(gitConfig(99L));

        GitSyncConfigResponse response = service.setEnabled(4L, 10L, false);

        assertThat(response.enabled()).isFalse();
        WbGitSyncConfig disabledConfig = existing("feature/policy-review");
        disabledConfig.setEnabled(false);
        String expectedSource = GitSyncFlowSourceBuilder.buildSyncFlowSource(
                disabledConfig,
                "*/5 * * * *",
                null,
                "WB_DATA_INTERNAL_TOKEN"
        );
        InOrder order = inOrder(kestraClient, mapper);
        order.verify(kestraClient).upsertFlow(expectedSource);
        order.verify(mapper).updateById(config);
    }

    @Test
    void setEnabled_doesNotUpdateConfigWhenKestraUpsertFails() {
        WbGitSyncConfigMapper mapper = Mockito.mock(WbGitSyncConfigMapper.class);
        GitConfigService gitConfigService = Mockito.mock(GitConfigService.class);
        GitCommandService gitCommandService = Mockito.mock(GitCommandService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        GitSyncConfigService service = service(mapper, gitConfigService, gitCommandService, kestraClient);

        when(mapper.selectById(10L)).thenReturn(existing("feature/policy-review"));
        when(gitConfigService.requireDecryptedConfig(4L)).thenReturn(gitConfig(99L));
        doThrow(new RuntimeException("Kestra rejected flow")).when(kestraClient).upsertFlow(any(String.class));

        assertThatThrownBy(() -> service.setEnabled(4L, 10L, false))
                .isInstanceOf(RuntimeException.class)
                .hasMessage("Kestra rejected flow");
        verify(mapper, never()).updateById(any(WbGitSyncConfig.class));
    }

    @Test
    void trigger_recreatesMissingKestraSyncFlowAndRetriesOn404() {
        WbGitSyncConfigMapper mapper = Mockito.mock(WbGitSyncConfigMapper.class);
        GitConfigService gitConfigService = Mockito.mock(GitConfigService.class);
        GitCommandService gitCommandService = Mockito.mock(GitCommandService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        GitSyncConfigService service = service(mapper, gitConfigService, gitCommandService, kestraClient);

        WbGitSyncConfig config = existing("feature/policy-review");
        String syncFlowId = GitSyncFlowSourceBuilder.buildSyncFlowId(4L, "feature/policy-review");
        when(mapper.selectById(10L)).thenReturn(config);
        when(gitConfigService.requireDecryptedConfig(4L)).thenReturn(gitConfig(99L));
        KestraExecutionSnapshot snapshot = new KestraExecutionSnapshot(
                "exec-healed-1", "system", syncFlowId, "CREATED",
                null, Instant.now(), Instant.now(), null,
                List.of(), Map.of(), Map.of(), Map.of()
        );
        when(kestraClient.createExecution(GitSyncFlowSourceBuilder.SYSTEM_NAMESPACE, syncFlowId))
                .thenThrow(new ResponseStatusException(HttpStatus.NOT_FOUND, "Flow not found"))
                .thenReturn(snapshot);

        TriggerGitSyncResponse response = service.trigger(4L, 10L);

        assertThat(response.executionId()).isEqualTo("exec-healed-1");
        assertThat(response.status()).isEqualTo("CREATED");
        String expectedSource = GitSyncFlowSourceBuilder.buildSyncFlowSource(
                existing("feature/policy-review"),
                "*/5 * * * *",
                null,
                "WB_DATA_INTERNAL_TOKEN"
        );
        InOrder order = inOrder(kestraClient, mapper);
        order.verify(kestraClient).createExecution(GitSyncFlowSourceBuilder.SYSTEM_NAMESPACE, syncFlowId);
        order.verify(kestraClient).upsertFlow(expectedSource);
        order.verify(kestraClient).createExecution(GitSyncFlowSourceBuilder.SYSTEM_NAMESPACE, syncFlowId);
        order.verify(mapper).updateById(config);
    }

    @Test
    void trigger_doesNotRecreateSyncFlowOnNon404Error() {
        WbGitSyncConfigMapper mapper = Mockito.mock(WbGitSyncConfigMapper.class);
        GitConfigService gitConfigService = Mockito.mock(GitConfigService.class);
        GitCommandService gitCommandService = Mockito.mock(GitCommandService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        GitSyncConfigService service = service(mapper, gitConfigService, gitCommandService, kestraClient);

        WbGitSyncConfig config = existing("feature/policy-review");
        String syncFlowId = GitSyncFlowSourceBuilder.buildSyncFlowId(4L, "feature/policy-review");
        when(mapper.selectById(10L)).thenReturn(config);
        when(kestraClient.createExecution(GitSyncFlowSourceBuilder.SYSTEM_NAMESPACE, syncFlowId))
                .thenThrow(new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Kestra down"));

        assertThatThrownBy(() -> service.trigger(4L, 10L))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("Kestra down");
        verify(kestraClient, never()).upsertFlow(any(String.class));
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
        return new GitSyncConfigService(mapper, Mockito.mock(OfflinePublishRecordService.class),
                gitConfigService, gitCommandService, kestraClient, kestraProperties, syncProperties,
                new OfflineTransferProperties());
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

    private void materializeConditionValueSegments(List<ISqlSegment> normalSegments) {
        normalSegments.get(2).getSqlSegment();
        normalSegments.get(6).getSqlSegment();
    }
}
