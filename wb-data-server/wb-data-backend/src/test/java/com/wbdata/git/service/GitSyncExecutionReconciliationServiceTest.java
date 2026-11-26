package com.wbdata.git.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.wbdata.git.entity.WbGitSyncConfig;
import com.wbdata.git.mapper.WbGitSyncConfigMapper;
import com.wbdata.git.mapper.WbOfflinePublishRecordMapper;
import com.wbdata.offline.kestra.KestraClient;
import com.wbdata.offline.kestra.KestraExecutionPage;
import com.wbdata.offline.kestra.KestraExecutionSnapshot;
import com.wbdata.offline.repo.service.GitCommandService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class GitSyncExecutionReconciliationServiceTest {

    private static final String SHA = "0123456789012345678901234567890123456789";

    private final WbGitSyncConfigMapper syncConfigMapper = Mockito.mock(WbGitSyncConfigMapper.class);
    private final OfflinePublishRecordService publishRecordService = Mockito.mock(OfflinePublishRecordService.class);
    private final GitCommandService gitCommandService = Mockito.mock(GitCommandService.class);
    private final KestraClient kestraClient = Mockito.mock(KestraClient.class);
    private final GitSyncExecutionReconciliationService service = new GitSyncExecutionReconciliationService(
            syncConfigMapper,
            Mockito.mock(WbOfflinePublishRecordMapper.class),
            publishRecordService,
            gitCommandService,
            kestraClient
    );

    @BeforeEach
    void noIdentifierCollisionByDefault() {
        when(syncConfigMapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of());
    }

    @Test
    void confirmsMatchingOutputsAndNormalizedFlowSource() {
        WbGitSyncConfig config = config();
        when(gitCommandService.readFlowFilesAtRevision(4L, SHA))
                .thenReturn(Map.of(".wb-data/kestra-flows/daily.yaml", flowSource("pg-4")));
        when(kestraClient.exportNamespaceFlowSources("g4-main"))
                .thenReturn(Map.of("daily", flowSource("g4-main")));

        service.reconcileExecution(config, execution("SUCCESS", Map.of("start_sha", SHA, "end_sha", SHA)));

        assertThat(config.getDeploymentEvidence()).isEqualTo("CONFIRMED");
        assertThat(config.getLastDeployedSha()).isEqualTo(SHA);
        assertThat(config.getLastEvidenceAt()).isEqualTo(LocalDateTime.ofInstant(
                Instant.parse("2026-11-08T01:00:00Z"), ZoneId.systemDefault()));
        verify(syncConfigMapper).update(Mockito.eq(config), any(LambdaUpdateWrapper.class));
        verify(gitCommandService, never()).readFlowFileAtRevision(Mockito.anyLong(), Mockito.anyString(), Mockito.anyString());
        verify(kestraClient, never()).getFlowSource(Mockito.anyString(), Mockito.anyString());
    }

    @Test
    void marksMismatchingOutputsUnknownWithoutReadingGit() {
        WbGitSyncConfig config = config();

        service.reconcileExecution(config, execution("SUCCESS", Map.of(
                "start_sha", SHA,
                "end_sha", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")));

        assertThat(config.getDeploymentEvidence()).isEqualTo("UNKNOWN");
        assertThat(config.getLastDeployedSha()).isNull();
        verify(gitCommandService, never()).listFlowFilesAtRevision(Mockito.anyLong(), Mockito.anyString());
    }

    @Test
    void startedFailureKeepsLastConfirmedShaButClearsCurrentEvidence() {
        WbGitSyncConfig config = config();
        config.setLastDeployedSha(SHA);
        config.setDeploymentEvidence("CONFIRMED");

        service.reconcileExecution(config, execution("FAILED", Map.of()));

        assertThat(config.getDeploymentEvidence()).isEqualTo("UNKNOWN");
        assertThat(config.getLastDeployedSha()).isEqualTo(SHA);
    }

    @Test
    void rejectsIdentifierCollisionEvenWhenOutputsMatch() {
        WbGitSyncConfig config = config();
        config.setBranch("feature/a");
        WbGitSyncConfig other = new WbGitSyncConfig();
        other.setId(8L);
        other.setGroupId(4L);
        other.setBranch("feature/a");
        when(syncConfigMapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of(other));

        service.reconcileExecution(config, execution("SUCCESS", Map.of("start_sha", SHA, "end_sha", SHA)));

        assertThat(config.getDeploymentEvidence()).isEqualTo("UNKNOWN");
        verify(gitCommandService, never()).listFlowFilesAtRevision(Mockito.anyLong(), Mockito.anyString());
    }

    @Test
    void doesNotTreatSlashAndHyphenBranchesAsColliding() {
        WbGitSyncConfig config = config();
        config.setBranch("feature/a");
        WbGitSyncConfig other = new WbGitSyncConfig();
        other.setId(8L);
        other.setGroupId(4L);
        other.setBranch("feature-a");
        String namespace = GitSyncFlowSourceBuilder.buildKestraNamespace(4L, "feature/a");
        when(syncConfigMapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of(other));
        when(gitCommandService.readFlowFilesAtRevision(4L, SHA))
                .thenReturn(Map.of(".wb-data/kestra-flows/daily.yaml", flowSource("pg-4")));
        when(kestraClient.exportNamespaceFlowSources(namespace))
                .thenReturn(Map.of("daily", flowSource(namespace)));

        service.reconcileExecution(config, execution("SUCCESS", Map.of("start_sha", SHA, "end_sha", SHA)));

        assertThat(config.getDeploymentEvidence()).isEqualTo("CONFIRMED");
    }

    @Test
    void marksMissingOrMismatchedFlowSourceUnknownDuringBulkVerification() {
        WbGitSyncConfig missingConfig = config();
        when(gitCommandService.readFlowFilesAtRevision(4L, SHA))
                .thenReturn(Map.of(".wb-data/kestra-flows/daily.yaml", flowSource("pg-4")));
        when(kestraClient.exportNamespaceFlowSources("g4-main")).thenReturn(Map.of());

        service.reconcileExecution(missingConfig, execution("SUCCESS", Map.of("start_sha", SHA, "end_sha", SHA)));
        assertThat(missingConfig.getDeploymentEvidence()).isEqualTo("UNKNOWN");

        WbGitSyncConfig mismatchConfig = config();
        when(kestraClient.exportNamespaceFlowSources("g4-main"))
                .thenReturn(Map.of("daily", "id: daily\nnamespace: g4-main\ntasks:\n  - id: drift\n"));

        service.reconcileExecution(mismatchConfig, execution("SUCCESS", Map.of("start_sha", SHA, "end_sha", SHA)));
        assertThat(mismatchConfig.getDeploymentEvidence()).isEqualTo("UNKNOWN");
    }

    @Test
    void marksStaleMissingExecutionUnknown() {
        WbGitSyncConfig config = config();
        config.setLastSyncAt(LocalDateTime.now().minusMinutes(5));
        config.setLastSyncStatus("CREATED");
        config.setLastSyncMessage("missing-execution");

        service.reconcileMissingExecution(config);

        assertThat(config.getLastSyncStatus()).isEqualTo("UNKNOWN");
        assertThat(config.getDeploymentEvidence()).isEqualTo("UNKNOWN");
        verify(syncConfigMapper).updateById(config);
    }

    @Test
    void ignoresStaleExecutionEvidence() {
        WbGitSyncConfig config = config();
        config.setDeploymentEvidence("CONFIRMED");
        config.setLastDeployedSha(SHA);
        config.setLastEvidenceAt(LocalDateTime.ofInstant(
                Instant.parse("2026-11-08T02:00:00Z"), ZoneId.systemDefault()));

        service.reconcileExecution(config, execution("FAILED", Map.of()));

        assertThat(config.getDeploymentEvidence()).isEqualTo("CONFIRMED");
        verify(syncConfigMapper, never()).updateById(config);
        verify(syncConfigMapper, never()).update(Mockito.eq(config), any(LambdaUpdateWrapper.class));
    }

    @Test
    void reconcile_fetchesOnlyLatestSingleExecutionViaPagedSearch() {
        WbGitSyncConfig config = config();
        when(syncConfigMapper.selectList(any(LambdaQueryWrapper.class))).thenReturn(List.of(config), List.of());
        when(gitCommandService.readFlowFilesAtRevision(4L, SHA))
                .thenReturn(Map.of(".wb-data/kestra-flows/daily.yaml", flowSource("pg-4")));
        when(kestraClient.exportNamespaceFlowSources("g4-main"))
                .thenReturn(Map.of("daily", flowSource("g4-main")));
        when(kestraClient.searchExecutionsPage(
                Map.of(
                        "filters[namespace][EQUALS]", GitSyncFlowSourceBuilder.SYSTEM_NAMESPACE,
                        "filters[flowId][EQUALS]", "sync-flows-g4-main"
                ),
                1,
                1,
                "state.startDate:desc"
        )).thenReturn(new KestraExecutionPage(
                List.of(execution("SUCCESS", Map.of("start_sha", SHA, "end_sha", SHA))),
                1200L
        ));

        service.reconcile();

        verify(kestraClient).searchExecutionsPage(
                Map.of(
                        "filters[namespace][EQUALS]", GitSyncFlowSourceBuilder.SYSTEM_NAMESPACE,
                        "filters[flowId][EQUALS]", "sync-flows-g4-main"
                ),
                1,
                1,
                "state.startDate:desc"
        );
        verify(kestraClient, never()).searchExecutions(any());
        assertThat(config.getDeploymentEvidence()).isEqualTo("CONFIRMED");
    }

    private WbGitSyncConfig config() {
        WbGitSyncConfig config = new WbGitSyncConfig();
        config.setId(7L);
        config.setGroupId(4L);
        config.setBranch("main");
        config.setEnabled(true);
        return config;
    }

    private KestraExecutionSnapshot execution(String status, Map<String, String> outputs) {
        return new KestraExecutionSnapshot(
                "execution-1",
                "system",
                "sync-flows-g4-main",
                status,
                null,
                Instant.parse("2026-11-08T00:59:00Z"),
                Instant.parse("2026-11-08T00:59:30Z"),
                Instant.parse("2026-11-08T01:00:00Z"),
                List.of(),
                Map.of(),
                Map.of(),
                outputs
        );
    }

    private String flowSource(String namespace) {
        return "id: daily\nnamespace: " + namespace + "\ntasks: []\n";
    }
}
