package com.wbdata.workspace.service;

import com.wbdata.auth.context.GroupAccessContext;
import com.wbdata.auth.enums.Permission;
import com.wbdata.auth.enums.SystemRole;
import com.wbdata.auth.service.AuthSession;
import com.wbdata.datasource.entity.DataSource;
import com.wbdata.datasource.mapper.DataSourceMapper;
import com.wbdata.git.dto.GitSyncConfigListResponse;
import com.wbdata.git.dto.GitSyncConfigResponse;
import com.wbdata.git.service.GitSyncConfigService;
import com.wbdata.group.mapper.WbProjectGroupMemberMapper;
import com.wbdata.offline.entity.WbOfflineFlowIndex;
import com.wbdata.offline.repo.dto.OfflineRepoStatusResponse;
import com.wbdata.offline.repo.dto.OfflineRepoTreeNodeResponse;
import com.wbdata.offline.repo.dto.OfflineRepoTreeResponse;
import com.wbdata.offline.repo.service.OfflineRepoStatusService;
import com.wbdata.offline.service.OfflineBranchSummaryService;
import com.wbdata.offline.service.OfflineFlowIndexService;
import com.wbdata.offline.service.OfflineRecentFlowService;
import com.wbdata.offline.service.OfflineRepoTreeService;
import com.wbdata.operations.dto.OperationsExecutionListItem;
import com.wbdata.operations.dto.OperationsExecutionListResponse;
import com.wbdata.operations.dto.OperationsExecutionQuery;
import com.wbdata.operations.dto.OperationsExecutionStatusCounts;
import com.wbdata.operations.service.OperationsExecutionService;
import com.wbdata.parameter.mapper.WbParameterGroupMapper;
import com.wbdata.workspace.dto.WorkspaceSummaryResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class WorkspaceSummaryServiceTest {

    @Mock
    private DataSourceMapper dataSourceMapper;
    @Mock
    private OfflineRepoStatusService offlineRepoStatusService;
    @Mock
    private OfflineRepoTreeService offlineRepoTreeService;
    @Mock
    private OfflineBranchSummaryService offlineBranchSummaryService;
    @Mock
    private OperationsExecutionService operationsExecutionService;
    @Mock
    private WbParameterGroupMapper parameterGroupMapper;
    @Mock
    private GitSyncConfigService gitSyncConfigService;
    @Mock
    private WbProjectGroupMemberMapper projectGroupMemberMapper;
    @Mock
    private OfflineFlowIndexService offlineFlowIndexService;
    @Mock
    private OfflineRecentFlowService offlineRecentFlowService;

    private WorkspaceSummaryService service;

    @BeforeEach
    void setUp() {
        service = new WorkspaceSummaryService(
                dataSourceMapper,
                offlineRepoStatusService,
                offlineRepoTreeService,
                offlineBranchSummaryService,
                operationsExecutionService,
                parameterGroupMapper,
                gitSyncConfigService,
                projectGroupMemberMapper
        );
    }

    @Test
    void defaultsToMainBranchSnapshotWhileKeepingWorkingTreeRecentFlows() {
        AuthSession user = new AuthSession(10L, "linchen", "林晨", SystemRole.USER.name(), Instant.now().plusSeconds(3600));
        GroupAccessContext access = new GroupAccessContext(
                user,
                1L,
                "电商核心数仓",
                "GROUP_ADMIN",
                false,
                Set.of(
                        Permission.DATASOURCE_READ.code(),
                        Permission.QUERY_USE.code(),
                        Permission.OFFLINE_READ.code(),
                        Permission.PARAMETER_READ.code(),
                        Permission.GROUP_SETTINGS.code(),
                        Permission.MEMBER_READ.code()
                )
        );

        when(dataSourceMapper.selectList(any())).thenReturn(List.of(
                dataSource(1L, "prod_mysql", "MYSQL", "order_db", "ENABLED"),
                dataSource(2L, "dwh_hive", "HIVE", "dw_prod", "ENABLED"),
                dataSource(3L, "old_mysql", "MYSQL", "legacy", "DISABLED")
        ));

        Instant featureCommitAt = Instant.parse("2026-11-25T15:00:00Z");
        Instant mainCommitAt = Instant.parse("2026-11-25T14:00:00Z");
        when(offlineRepoStatusService.getRepoStatus(1L)).thenReturn(new OfflineRepoStatusResponse(
                1L, "/data/repos/wb-data-1", true, true, true, false, true, true,
                "feature/policy-review", "def5678", "wip: feature change", featureCommitAt
        ));
        when(offlineBranchSummaryService.listAvailableBranches(1L))
                .thenReturn(List.of("main", "feature/policy-review"));
        when(offlineBranchSummaryService.summarizeBranch(1L, "main"))
                .thenReturn(new OfflineBranchSummaryService.BranchSnapshotSummary(
                        "main", true, "abc1234", "fix(dwd): 补齐退款口径", mainCommitAt,
                        true, true, 12, 8
                ));
        when(offlineRepoStatusService.listDirtyFlowPaths(1L))
                .thenReturn(Set.of("_flows/ods/ods_order_pay_sync/flow.yaml"));

        OfflineRepoTreeNodeResponse flow1 = new OfflineRepoTreeNodeResponse(
                "_flows/ods/ods_order_pay_sync/flow.yaml", "FLOW", "ods_order_pay_sync",
                "_flows/ods/ods_order_pay_sync/flow.yaml", List.of(), "ENABLED", "DAILY", 0
        );
        OfflineRepoTreeNodeResponse flow2 = new OfflineRepoTreeNodeResponse(
                "_flows/dwd/dwd_trade_detail_di/flow.yaml", "FLOW", "dwd_trade_detail_di",
                "_flows/dwd/dwd_trade_detail_di/flow.yaml", List.of(), "DISABLED", "DAILY", 1
        );
        OfflineRepoTreeNodeResponse root = OfflineRepoTreeNodeResponse.directory(
                "group-1", "ROOT", "电商核心数仓", "",
                List.of(OfflineRepoTreeNodeResponse.directory("_flows", "DIRECTORY", "_flows", "_flows", List.of(flow1, flow2)))
        );
        when(offlineRepoTreeService.getRepoTree(1L, "电商核心数仓", 10L)).thenReturn(
                new OfflineRepoTreeResponse(1L, root, List.of("_flows/ods/ods_order_pay_sync/flow.yaml"))
        );

        OperationsExecutionListItem runningItem = executionItem("exec-run", "ads_gmv_hourly", "RUNNING", Instant.parse("2026-11-25T14:10:00Z"));
        OperationsExecutionListItem failedItem = executionItem("exec-fail", "ods_order_pay_sync", "FAILED", Instant.parse("2026-11-25T13:00:00Z"));
        OperationsExecutionListItem successItem = executionItem("exec-ok", "dwd_member_df", "SUCCESS", Instant.parse("2026-11-25T12:00:00Z"));
        when(operationsExecutionService.listExecutions(eq(1L), any())).thenReturn(new OperationsExecutionListResponse(
                List.of("main"), "main", Instant.now().minusSeconds(3600), Instant.now(), 1, 50, 3, 1,
                List.of(runningItem, failedItem, successItem),
                new OperationsExecutionStatusCounts(3, 1, 1, 1, 0)
        ));

        when(parameterGroupMapper.selectCount(any())).thenReturn(6L);
        when(gitSyncConfigService.list(1L)).thenReturn(new GitSyncConfigListResponse(
                List.of(new GitSyncConfigResponse(
                        11L, 1L, "main", "g1-main", "sync-flows-g1-main", true,
                        LocalDateTime.of(2026, 11, 25, 22, 10), "SUCCESS", "ok", "abc1234",
                        LocalDateTime.of(2026, 11, 25, 22, 10), "CONFIRMED"
                )),
                List.of("main"),
                "0 */5 * * * *"
        ));
        when(projectGroupMemberMapper.selectCount(any())).thenReturn(5L);

        WorkspaceSummaryResponse summary = service.getSummary(access);

        assertThat(summary.groupId()).isEqualTo(1L);
        assertThat(summary.role()).isEqualTo("GROUP_ADMIN");
        assertThat(summary.onboarding()).isFalse();

        assertThat(summary.datasources().total()).isEqualTo(3);
        assertThat(summary.datasources().enabledCount()).isEqualTo(2);
        assertThat(summary.datasources().byType()).extracting("type", "count")
                .containsExactly(org.assertj.core.groups.Tuple.tuple("MYSQL", 2), org.assertj.core.groups.Tuple.tuple("HIVE", 1));

        assertThat(summary.offline().branch()).isEqualTo("main");
        assertThat(summary.offline().workingTreeBranch()).isEqualTo("feature/policy-review");
        assertThat(summary.offline().availableBranches()).containsExactly("main", "feature/policy-review");
        assertThat(summary.offline().flowCount()).isEqualTo(12);
        assertThat(summary.offline().scheduledFlowCount()).isEqualTo(8);
        assertThat(summary.offline().headCommitMessage()).isEqualTo("fix(dwd): 补齐退款口径");
        assertThat(summary.offline().ahead()).isTrue();
        assertThat(summary.offline().dirty()).isTrue();
        assertThat(summary.offline().dirtyFlowCount()).isEqualTo(1);
        assertThat(summary.offline().recentFlows()).hasSize(2);
        assertThat(summary.offline().recentFlows().get(0).name()).isEqualTo("ods_order_pay_sync");
        assertThat(summary.offline().recentFlows().get(0).dirty()).isTrue();

        assertThat(summary.operations().available()).isTrue();
        assertThat(summary.operations().selectedBranch()).isEqualTo("main");
        assertThat(summary.operations().branchSynced()).isTrue();
        assertThat(summary.operations().availableBranches()).containsExactly("main");
        assertThat(summary.operations().attentionExecutions()).extracting("id")
                .containsExactly("exec-fail", "exec-run");
        assertThat(summary.operations().recentExecutions()).hasSize(3);

        ArgumentCaptor<OperationsExecutionQuery> queryCaptor = ArgumentCaptor.forClass(OperationsExecutionQuery.class);
        verify(operationsExecutionService).listExecutions(eq(1L), queryCaptor.capture());
        assertThat(queryCaptor.getValue().branch()).isEqualTo("main");

        assertThat(summary.parameters().activeCount()).isEqualTo(6);
        assertThat(summary.gitSync().configured()).isTrue();
        assertThat(summary.members().totalCount()).isEqualTo(5);
    }

    @Test
    void usesLiveWorkingTreeStatsAndMarksUnsyncedWhenSelectedBranchMatchesWorkingTree() {
        AuthSession user = new AuthSession(10L, "linchen", "林晨", SystemRole.USER.name(), Instant.now().plusSeconds(3600));
        GroupAccessContext access = new GroupAccessContext(
                user,
                1L,
                "电商核心数仓",
                "GROUP_ADMIN",
                false,
                Set.of(Permission.OFFLINE_READ.code())
        );

        Instant featureCommitAt = Instant.parse("2026-11-25T15:00:00Z");
        when(offlineRepoStatusService.getRepoStatus(1L)).thenReturn(new OfflineRepoStatusResponse(
                1L, "/data/repos/wb-data-1", true, true, true, false, true, false,
                "feature/policy-review", "def5678", "wip: feature", featureCommitAt
        ));
        when(offlineBranchSummaryService.listAvailableBranches(1L))
                .thenReturn(List.of("main", "feature/policy-review"));
        when(offlineRepoStatusService.listDirtyFlowPaths(1L)).thenReturn(Set.of());

        OfflineRepoTreeNodeResponse flow1 = new OfflineRepoTreeNodeResponse(
                "_flows/ods/flow1/flow.yaml", "FLOW", "flow1",
                "_flows/ods/flow1/flow.yaml", List.of(), "ENABLED", "DAILY", 0
        );
        OfflineRepoTreeNodeResponse root = OfflineRepoTreeNodeResponse.directory(
                "group-1", "ROOT", "电商核心数仓", "",
                List.of(OfflineRepoTreeNodeResponse.directory("_flows", "DIRECTORY", "_flows", "_flows", List.of(flow1)))
        );
        when(offlineRepoTreeService.getRepoTree(1L, "电商核心数仓", 10L))
                .thenReturn(new OfflineRepoTreeResponse(1L, root, List.of()));
        when(operationsExecutionService.listExecutions(eq(1L), any())).thenReturn(new OperationsExecutionListResponse(
                List.of("main"), "feature/policy-review", Instant.now().minusSeconds(3600), Instant.now(),
                1, 50, 0, 0, List.of(), new OperationsExecutionStatusCounts(0, 0, 0, 0, 0)
        ));

        WorkspaceSummaryResponse summary = service.getSummary(access, "feature/policy-review");

        assertThat(summary.offline().branch()).isEqualTo("feature/policy-review");
        assertThat(summary.offline().workingTreeBranch()).isEqualTo("feature/policy-review");
        assertThat(summary.offline().flowCount()).isEqualTo(1);
        assertThat(summary.offline().scheduledFlowCount()).isEqualTo(1);
        assertThat(summary.offline().headCommitMessage()).isEqualTo("wip: feature");
        assertThat(summary.operations().selectedBranch()).isEqualTo("feature/policy-review");
        assertThat(summary.operations().branchSynced()).isFalse();
        verify(offlineBranchSummaryService, never()).summarizeBranch(eq(1L), any());
    }

    @Test
    void doesNotTriggerOnboardingWhenMainIsEmptyButWorkingTreeHasFlows() {
        AuthSession user = new AuthSession(10L, "linchen", "林晨", SystemRole.USER.name(), Instant.now().plusSeconds(3600));
        GroupAccessContext access = new GroupAccessContext(
                user,
                1L,
                "电商核心数仓",
                "GROUP_ADMIN",
                false,
                Set.of(Permission.OFFLINE_READ.code())
        );

        when(offlineRepoStatusService.getRepoStatus(1L)).thenReturn(new OfflineRepoStatusResponse(
                1L, "/data/repos/wb-data-1", true, true, true, false, false, false,
                "feature/init", "def5678", "wip", Instant.parse("2026-11-25T15:00:00Z")
        ));
        when(offlineBranchSummaryService.listAvailableBranches(1L))
                .thenReturn(List.of("main", "feature/init"));
        when(offlineBranchSummaryService.summarizeBranch(1L, "main"))
                .thenReturn(new OfflineBranchSummaryService.BranchSnapshotSummary(
                        "main", true, "abc1234", "init empty main", Instant.parse("2026-11-25T14:00:00Z"),
                        false, false, 0, 0
                ));
        when(offlineRepoStatusService.listDirtyFlowPaths(1L)).thenReturn(Set.of("_flows/ods/draft/flow.yaml"));
        OfflineRepoTreeNodeResponse draftFlow = new OfflineRepoTreeNodeResponse(
                "_flows/ods/draft/flow.yaml", "FLOW", "draft",
                "_flows/ods/draft/flow.yaml", List.of(), "NONE", null, 0
        );
        when(offlineRepoTreeService.getRepoTree(1L, "电商核心数仓", 10L)).thenReturn(
                new OfflineRepoTreeResponse(1L, OfflineRepoTreeNodeResponse.directory(
                        "group-1", "ROOT", "电商核心数仓", "",
                        List.of(OfflineRepoTreeNodeResponse.directory("_flows", "DIRECTORY", "_flows", "_flows", List.of(draftFlow)))
                ), List.of())
        );
        when(operationsExecutionService.listExecutions(eq(1L), any())).thenReturn(new OperationsExecutionListResponse(
                List.of("main"), "main", Instant.now().minusSeconds(3600), Instant.now(),
                1, 50, 0, 0, List.of(), new OperationsExecutionStatusCounts(0, 0, 0, 0, 0)
        ));

        WorkspaceSummaryResponse summary = service.getSummary(access);

        assertThat(summary.onboarding()).isFalse();
        assertThat(summary.offline().flowCount()).isZero();
        assertThat(summary.offline().dirtyFlowCount()).isEqualTo(1);
    }

    @Test
    void omitsUnauthorizedSectionsForQueryOnlyUser() {
        AuthSession user = new AuthSession(20L, "zhoumin", "周敏", SystemRole.USER.name(), Instant.now().plusSeconds(3600));
        GroupAccessContext access = new GroupAccessContext(
                user,
                2L,
                "电商核心数仓",
                "ANALYST",
                false,
                Set.of(Permission.DATASOURCE_READ.code(), Permission.QUERY_USE.code())
        );

        when(dataSourceMapper.selectList(any())).thenReturn(List.of(
                dataSource(1L, "prod_mysql", "MYSQL", "order_db", "ENABLED")
        ));

        WorkspaceSummaryResponse summary = service.getSummary(access);

        assertThat(summary.onboarding()).isFalse();
        assertThat(summary.datasources()).isNotNull();
        assertThat(summary.datasources().total()).isEqualTo(1);
        assertThat(summary.offline()).isNull();
        assertThat(summary.operations()).isNull();
        assertThat(summary.parameters()).isNull();
        assertThat(summary.gitSync()).isNull();
        assertThat(summary.members()).isNull();

        verifyNoInteractions(offlineRepoStatusService, offlineRepoTreeService, offlineBranchSummaryService,
                operationsExecutionService, parameterGroupMapper, gitSyncConfigService, projectGroupMemberMapper);
    }

    @Test
    void detectsOnboardingAndDegradesGracefullyWhenKestraFails() {
        AuthSession user = new AuthSession(1L, "admin", "管理员", SystemRole.SYSTEM_ADMIN.name(), Instant.now().plusSeconds(3600));
        GroupAccessContext access = new GroupAccessContext(
                user,
                3L,
                "新业务分析组",
                null,
                true,
                Set.of(Permission.DATASOURCE_READ.code(), Permission.OFFLINE_READ.code())
        );

        when(dataSourceMapper.selectList(any())).thenReturn(List.of());
        when(offlineRepoStatusService.getRepoStatus(3L)).thenReturn(new OfflineRepoStatusResponse(
                3L, "/data/repos/wb-data-3", true, true, false, false, false, false,
                "main", null, null, null
        ));
        when(offlineBranchSummaryService.listAvailableBranches(3L)).thenReturn(List.of("main"));
        when(offlineRepoStatusService.listDirtyFlowPaths(3L)).thenReturn(Set.of());
        when(offlineRepoTreeService.getRepoTree(3L, "新业务分析组", 1L)).thenReturn(
                new OfflineRepoTreeResponse(3L, OfflineRepoTreeNodeResponse.directory("group-3", "ROOT", "新业务分析组", "", List.of()))
        );
        when(operationsExecutionService.listExecutions(eq(3L), any()))
                .thenThrow(new IllegalStateException("Connection refused"));

        WorkspaceSummaryResponse summary = service.getSummary(access);

        assertThat(summary.role()).isEqualTo("SYSTEM_ADMIN");
        assertThat(summary.onboarding()).isTrue();
        assertThat(summary.operations().available()).isFalse();
        assertThat(summary.operations().selectedBranch()).isEqualTo("main");
        assertThat(summary.operations().branchSynced()).isFalse();
        assertThat(summary.operations().availableBranches()).isEmpty();
        assertThat(summary.operations().errorMessage()).contains("Kestra");
        assertThat(summary.operations().counts().total()).isZero();
        assertThat(summary.operations().attentionExecutions()).isEmpty();
    }

    @Test
    void fallsBackToWorkingTreeOrFirstSyncedBranchWhenMainDoesNotExist() {
        AuthSession user = new AuthSession(10L, "linchen", "林晨", SystemRole.USER.name(), Instant.now().plusSeconds(3600));
        GroupAccessContext access = new GroupAccessContext(
                user,
                1L,
                "电商核心数仓",
                "GROUP_ADMIN",
                false,
                Set.of(Permission.OFFLINE_READ.code())
        );

        when(offlineRepoStatusService.getRepoStatus(1L)).thenReturn(new OfflineRepoStatusResponse(
                1L, "/data/repos/wb-data-1", true, true, false, false, false, false,
                "master", "abc1234", "init", Instant.parse("2026-11-25T14:00:00Z")
        ));
        when(offlineBranchSummaryService.listAvailableBranches(1L)).thenReturn(List.of("master"));
        when(offlineRepoStatusService.listDirtyFlowPaths(1L)).thenReturn(Set.of());
        when(offlineRepoTreeService.getRepoTree(1L, "电商核心数仓", 10L)).thenReturn(
                new OfflineRepoTreeResponse(1L, OfflineRepoTreeNodeResponse.directory("group-1", "ROOT", "电商核心数仓", "", List.of()))
        );

        OperationsExecutionListItem masterItem = new OperationsExecutionListItem(
                "exec-master", "g1-master", "daily_job", "master", "SUCCESS",
                Instant.parse("2026-11-25T12:00:00Z"), Instant.parse("2026-11-25T12:00:00Z"),
                Instant.parse("2026-11-25T12:00:00Z"), Instant.parse("2026-11-25T12:05:00Z"),
                300_000L, true, false, false
        );
        when(operationsExecutionService.listExecutions(eq(1L), any())).thenReturn(new OperationsExecutionListResponse(
                List.of("master", "dev"), "master", Instant.now().minusSeconds(3600), Instant.now(),
                1, 50, 1, 1, List.of(masterItem), new OperationsExecutionStatusCounts(1, 1, 0, 0, 0)
        ));

        WorkspaceSummaryResponse summary = service.getSummary(access);

        assertThat(summary.offline().branch()).isEqualTo("master");
        assertThat(summary.operations().selectedBranch()).isEqualTo("master");
        assertThat(summary.operations().branchSynced()).isTrue();
        assertThat(summary.offline().availableBranches()).containsExactly("master", "dev");

        ArgumentCaptor<OperationsExecutionQuery> queryCaptor = ArgumentCaptor.forClass(OperationsExecutionQuery.class);
        verify(operationsExecutionService, times(1)).listExecutions(eq(1L), queryCaptor.capture());
        assertThat(queryCaptor.getValue().branch()).isEqualTo("master");
    }

    @Test
    void usesFlowIndexInsteadOfRepoTreeWhenIndexIsEnabled() {
        WorkspaceSummaryService indexedService = new WorkspaceSummaryService(
                dataSourceMapper,
                offlineRepoStatusService,
                offlineRepoTreeService,
                offlineBranchSummaryService,
                operationsExecutionService,
                parameterGroupMapper,
                gitSyncConfigService,
                projectGroupMemberMapper,
                offlineFlowIndexService,
                offlineRecentFlowService
        );
        AuthSession user = new AuthSession(10L, "linchen", "林晨", SystemRole.USER.name(), Instant.now().plusSeconds(3600));
        GroupAccessContext access = new GroupAccessContext(
                user,
                1L,
                "电商核心数仓",
                "GROUP_ADMIN",
                false,
                Set.of(Permission.OFFLINE_READ.code())
        );

        when(offlineRepoStatusService.getRepoStatus(1L)).thenReturn(new OfflineRepoStatusResponse(
                1L, "/data/repos/wb-data-1", true, true, true, false, true, true,
                "main", "abc1234", "feat: index ready", Instant.parse("2026-11-26T10:00:00Z")
        ));
        when(offlineBranchSummaryService.listAvailableBranches(1L)).thenReturn(List.of("main"));
        when(offlineRepoStatusService.listDirtyFlowPaths(1L))
                .thenReturn(Set.of("_flows/flow.yaml", "_flows/dwd/alpha_job/flow.yaml"));

        Map<String, WbOfflineFlowIndex> indexedFlows = new LinkedHashMap<>();
        indexedFlows.put("_flows/dwd/zeta_job/flow.yaml", flowIndexRow(
                "_flows/dwd/zeta_job/flow.yaml", OfflineFlowIndexService.PARSE_STATUS_OK, true, true, "DAILY"
        ));
        indexedFlows.put("_flows/flow.yaml", flowIndexRow(
                "_flows/flow.yaml", OfflineFlowIndexService.PARSE_STATUS_OK, true, false, "HOURLY"
        ));
        indexedFlows.put("_flows/dwd/alpha_job/flow.yaml", flowIndexRow(
                "_flows/dwd/alpha_job/flow.yaml", OfflineFlowIndexService.PARSE_STATUS_OK, true, true, "DAILY"
        ));
        indexedFlows.put("_flows/ads/broken_job/flow.yaml", flowIndexRow(
                "_flows/ads/broken_job/flow.yaml", OfflineFlowIndexService.PARSE_STATUS_INVALID, true, true, "DAILY"
        ));
        indexedFlows.put("_flows/ads/beta_job/flow.yaml", flowIndexRow(
                "_flows/ads/beta_job/flow.yaml", OfflineFlowIndexService.PARSE_STATUS_OK, false, false, null
        ));

        when(offlineFlowIndexService.isEnabled()).thenReturn(true);
        when(offlineFlowIndexService.listGroupFlowMap(1L)).thenReturn(indexedFlows);
        when(offlineRecentFlowService.listRecentFlowPaths(10L, 1L)).thenReturn(List.of(
                "_flows/deleted_job/flow.yaml",
                "/_flows/flow.yaml",
                "_flows/dwd/zeta_job/flow.yaml"
        ));
        when(operationsExecutionService.listExecutions(eq(1L), any())).thenReturn(new OperationsExecutionListResponse(
                List.of("main"), "main", Instant.now().minusSeconds(3600), Instant.now(),
                1, 50, 0, 0, List.of(), new OperationsExecutionStatusCounts(0, 0, 0, 0, 0)
        ));

        WorkspaceSummaryResponse summary = indexedService.getSummary(access);

        assertThat(summary.onboarding()).isFalse();
        assertThat(summary.offline().flowCount()).isEqualTo(5);
        assertThat(summary.offline().scheduledFlowCount()).isEqualTo(2);
        assertThat(summary.offline().dirtyFlowCount()).isEqualTo(2);
        assertThat(summary.offline().recentFlows()).hasSize(4);

        WorkspaceSummaryResponse.RecentFlowItem first = summary.offline().recentFlows().get(0);
        assertThat(first.path()).isEqualTo("_flows/flow.yaml");
        assertThat(first.name()).isEqualTo("flow");
        assertThat(first.directory()).isEqualTo("_flows/");
        assertThat(first.scheduleState()).isEqualTo("DISABLED");
        assertThat(first.schedulePeriod()).isEqualTo("HOURLY");
        assertThat(first.dirty()).isTrue();

        WorkspaceSummaryResponse.RecentFlowItem second = summary.offline().recentFlows().get(1);
        assertThat(second.path()).isEqualTo("_flows/dwd/zeta_job/flow.yaml");
        assertThat(second.name()).isEqualTo("zeta_job");
        assertThat(second.directory()).isEqualTo("_flows/dwd/");
        assertThat(second.scheduleState()).isEqualTo("ENABLED");
        assertThat(second.dirty()).isFalse();

        // 字母序补齐剩余 2 项：alpha_job、beta_job（broken_job 排在其后）
        WorkspaceSummaryResponse.RecentFlowItem third = summary.offline().recentFlows().get(2);
        assertThat(third.path()).isEqualTo("_flows/dwd/alpha_job/flow.yaml");
        assertThat(third.name()).isEqualTo("alpha_job");
        assertThat(third.dirty()).isTrue();

        WorkspaceSummaryResponse.RecentFlowItem fourth = summary.offline().recentFlows().get(3);
        assertThat(fourth.path()).isEqualTo("_flows/ads/beta_job/flow.yaml");
        assertThat(fourth.name()).isEqualTo("beta_job");
        assertThat(fourth.scheduleState()).isEqualTo("NONE");

        verifyNoInteractions(offlineRepoTreeService);
    }

    @Test
    void usesFlowIndexForWorkingTreeRecentFlowsWhileViewingOtherBranch() {
        WorkspaceSummaryService indexedService = new WorkspaceSummaryService(
                dataSourceMapper,
                offlineRepoStatusService,
                offlineRepoTreeService,
                offlineBranchSummaryService,
                operationsExecutionService,
                parameterGroupMapper,
                gitSyncConfigService,
                projectGroupMemberMapper,
                offlineFlowIndexService,
                offlineRecentFlowService
        );
        AuthSession user = new AuthSession(10L, "linchen", "林晨", SystemRole.USER.name(), Instant.now().plusSeconds(3600));
        GroupAccessContext access = new GroupAccessContext(
                user,
                1L,
                "电商核心数仓",
                "GROUP_ADMIN",
                false,
                Set.of(Permission.OFFLINE_READ.code())
        );

        when(offlineRepoStatusService.getRepoStatus(1L)).thenReturn(new OfflineRepoStatusResponse(
                1L, "/data/repos/wb-data-1", true, true, false, false, false, false,
                "feature/dev", "def5678", "wip", Instant.parse("2026-11-26T10:00:00Z")
        ));
        when(offlineBranchSummaryService.listAvailableBranches(1L)).thenReturn(List.of("main", "feature/dev"));
        when(offlineBranchSummaryService.summarizeBranch(1L, "main")).thenReturn(
                new OfflineBranchSummaryService.BranchSnapshotSummary(
                        "main", true, "abc1234", "init empty main",
                        Instant.parse("2026-11-26T09:00:00Z"), false, false, 0, 0
                )
        );
        when(offlineRepoStatusService.listDirtyFlowPaths(1L)).thenReturn(Set.of());
        when(offlineFlowIndexService.isEnabled()).thenReturn(true);
        when(offlineFlowIndexService.listGroupFlowMap(1L)).thenReturn(Map.of(
                "_flows/ads/broken_draft/flow.yaml",
                flowIndexRow("_flows/ads/broken_draft/flow.yaml", OfflineFlowIndexService.PARSE_STATUS_INVALID, true, true, "DAILY")
        ));
        when(offlineRecentFlowService.listRecentFlowPaths(10L, 1L)).thenReturn(List.of());
        when(operationsExecutionService.listExecutions(eq(1L), any())).thenReturn(new OperationsExecutionListResponse(
                List.of("main"), "main", Instant.now().minusSeconds(3600), Instant.now(),
                1, 50, 0, 0, List.of(), new OperationsExecutionStatusCounts(0, 0, 0, 0, 0)
        ));

        WorkspaceSummaryResponse summary = indexedService.getSummary(access);

        assertThat(summary.onboarding()).isFalse();
        assertThat(summary.offline().branch()).isEqualTo("main");
        assertThat(summary.offline().flowCount()).isZero();
        assertThat(summary.offline().scheduledFlowCount()).isZero();
        assertThat(summary.offline().recentFlows()).hasSize(1);
        assertThat(summary.offline().recentFlows().get(0).name()).isEqualTo("broken_draft");
        assertThat(summary.offline().recentFlows().get(0).scheduleState()).isEqualTo("NONE");
        assertThat(summary.offline().recentFlows().get(0).schedulePeriod()).isNull();

        verify(offlineBranchSummaryService).summarizeBranch(1L, "main");
        verifyNoInteractions(offlineRepoTreeService);
    }

    private static WbOfflineFlowIndex flowIndexRow(String path,
                                                   String parseStatus,
                                                   boolean hasSchedule,
                                                   boolean scheduleEnabled,
                                                   String schedulePeriod) {
        WbOfflineFlowIndex row = new WbOfflineFlowIndex();
        row.setGroupId(1L);
        row.setFlowPath(path);
        row.setParseStatus(parseStatus);
        row.setHasSchedule(hasSchedule);
        row.setScheduleEnabled(scheduleEnabled);
        row.setSchedulePeriod(schedulePeriod);
        return row;
    }

    private static DataSource dataSource(Long id, String name, String type, String db, String status) {
        DataSource ds = new DataSource();
        ds.setId(id);
        ds.setGroupId(1L);
        ds.setName(name);
        ds.setType(type);
        ds.setDatabaseName(db);
        ds.setStatus(status);
        return ds;
    }

    private static OperationsExecutionListItem executionItem(String id, String flowId, String status, Instant startDate) {
        return new OperationsExecutionListItem(
                id, "g1-main", flowId, "main", status,
                startDate, startDate, startDate, null, 1200L,
                "FAILED".equals(status), "RUNNING".equals(status), false
        );
    }
}
