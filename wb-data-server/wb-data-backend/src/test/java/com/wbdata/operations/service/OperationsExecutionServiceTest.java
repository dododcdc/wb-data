package com.wbdata.operations.service;

import com.wbdata.git.dto.GitSyncConfigResponse;
import com.wbdata.git.service.GitSyncConfigService;
import com.wbdata.offline.service.KestraClient;
import com.wbdata.offline.service.KestraExecutionSnapshot;
import com.wbdata.offline.service.KestraLogEntry;
import com.wbdata.offline.service.KestraTaskRunSnapshot;
import com.wbdata.offline.service.ExecutionParameterSnapshotRegistry;
import com.wbdata.offline.service.ExecutionTimeContext;
import com.wbdata.offline.dto.FlowParameterDefinitionSnapshot;
import com.wbdata.offline.dto.FlowParameterSnapshot;
import com.wbdata.operations.dto.OperationsExecutionDetailResponse;
import com.wbdata.operations.dto.OperationsExecutionListItem;
import com.wbdata.operations.dto.OperationsExecutionListResponse;
import com.wbdata.operations.dto.OperationsExecutionQuery;
import com.wbdata.operations.dto.OperationsExecutionRerunResponse;
import com.wbdata.operations.entity.WbOperationExecutionAction;
import com.wbdata.operations.mapper.WbOperationExecutionActionMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class OperationsExecutionServiceTest {
    private static final Instant FROM = Instant.parse("2026-06-06T00:00:00Z");
    private static final Instant TO = Instant.parse("2026-06-08T00:00:00Z");

    @Test
    void executionDtos_exposeOnlyKestraBackedExecutionData() {
        assertThat(Arrays.stream(OperationsExecutionListItem.class.getRecordComponents())
                .map(component -> component.getName()))
                .containsExactly(
                        "id", "namespace", "flowId", "branch", "status",
                        "plannedAt", "createdAt", "startDate", "endDate", "durationMs", "rerunnable"
                );
        assertThat(Arrays.stream(OperationsExecutionDetailResponse.class.getRecordComponents())
                .map(component -> component.getName()))
                .containsExactly(
                        "id", "namespace", "flowId", "branch", "status",
                        "plannedAt", "createdAt", "startDate", "endDate", "durationMs", "rerunnable",
                        "taskRuns", "inputs", "labels", "parameterResolutionStatus", "parameters",
                        "parameterSnapshotChanged"
                );
        assertThat(Arrays.stream(OperationsExecutionListResponse.class.getRecordComponents())
                .map(component -> component.getName()))
                .containsExactly(
                        "branches", "selectedBranch", "from", "to",
                        "page", "pageSize", "total", "totalPages", "executions"
                );
    }

    @Test
    void listExecutions_returnsOnlyCurrentGroupBusinessNamespaces() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient);
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(syncConfigs());
        when(kestraClient.searchExecutions(searchFilter("g4-feature-policy-review"))).thenReturn(List.of(
                execution(
                        "exec-review",
                        "g4-feature-policy-review",
                        "daily_policy",
                        "FAILED",
                        "2026-06-07T01:00:00Z",
                        "2026-06-07T01:00:01Z",
                        "2026-06-07T01:00:06Z",
                        List.of(taskRun("load_policy", "FAILED"))
                ),
                execution("exec-sync", "g4-feature-policy-review", "sync-flows-g4-feature-policy-review", "SUCCESS", "2026-06-07T00:20:00Z")
        ));
        when(kestraClient.searchExecutions(searchFilter("g4-main"))).thenReturn(List.of(
                execution("exec-main", "g4-main", "main_job", "SUCCESS", "2026-06-07T00:30:00Z")
        ));

        OperationsExecutionListResponse response = service.listExecutions(4L, listQuery(
                null,
                null,
                null,
                FROM,
                TO
        ));

        assertThat(response.branches()).containsExactly("feature/policy-review", "main");
        assertThat(response.pageSize()).isEqualTo(50);
        assertThat(response.executions()).extracting("id").containsExactly("exec-review", "exec-main");
        assertThat(response.executions().getFirst().branch()).isEqualTo("feature/policy-review");
        assertThat(response.executions().getFirst().rerunnable()).isTrue();
        verify(kestraClient).searchExecutions(searchFilter("g4-feature-policy-review"));
        verify(kestraClient).searchExecutions(searchFilter("g4-main"));
    }

    @Test
    void listExecutions_appliesBranchFlowStatusAndTimeFilters() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient);
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(syncConfigs());
        when(kestraClient.searchExecutions(searchFilter("g4-feature-policy-review"))).thenReturn(List.of(
                execution("match", "g4-feature-policy-review", "daily_policy", "FAILED", "2026-06-07T01:00:00Z"),
                execution("wrong-flow", "g4-feature-policy-review", "monthly_policy", "FAILED", "2026-06-07T01:00:00Z"),
                execution("wrong-status", "g4-feature-policy-review", "daily_policy", "SUCCESS", "2026-06-07T01:00:00Z"),
                execution("too-old", "g4-feature-policy-review", "daily_policy", "FAILED", "2026-06-05T23:59:59Z")
        ));

        OperationsExecutionListResponse response = service.listExecutions(4L, listQuery(
                "feature/policy-review",
                "daily",
                "FAILED",
                FROM,
                TO
        ));

        assertThat(response.selectedBranch()).isEqualTo("feature/policy-review");
        assertThat(response.executions()).extracting("id").containsExactly("match");
        verify(kestraClient).searchExecutions(searchFilter("g4-feature-policy-review"));
        verify(kestraClient, never()).searchExecutions(searchFilter("g4-main"));
    }

    @Test
    void listExecutions_truncatesKestraSearchTimeRangeToMilliseconds() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient);
        Instant from = Instant.parse("2026-06-06T00:00:00.123456Z");
        Instant to = Instant.parse("2026-06-08T00:00:00.987654Z");
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(List.of(syncConfig("main", "g4-main")));
        when(kestraClient.searchExecutions(searchFilter(
                "g4-main",
                "2026-06-06T00:00:00.123Z",
                "2026-06-08T00:00:00.987Z"
        ))).thenReturn(List.of());

        service.listExecutions(4L, listQuery(
                "main",
                null,
                null,
                from,
                to
        ));

        verify(kestraClient).searchExecutions(searchFilter(
                "g4-main",
                "2026-06-06T00:00:00.123Z",
                "2026-06-08T00:00:00.987Z"
        ));
    }

    @Test
    void listExecutions_unknownBranchReturnsEmptyExecutionsWithoutSearchingKestra() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient);
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(syncConfigs());

        OperationsExecutionListResponse response = service.listExecutions(4L, listQuery(
                "missing",
                null,
                null,
                FROM,
                TO
        ));

        assertThat(response.branches()).containsExactly("feature/policy-review", "main");
        assertThat(response.selectedBranch()).isEqualTo("missing");
        assertThat(response.executions()).isEmpty();
        verify(kestraClient, never()).searchExecutions(Mockito.any());
    }

    @Test
    void listExecutions_sortsByCreatedAtFallbackToStartDateDescending() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient);
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(syncConfigs());
        when(kestraClient.searchExecutions(searchFilter("g4-feature-policy-review"))).thenReturn(List.of(
                execution(
                        "fallback-older",
                        "g4-feature-policy-review",
                        "daily_policy",
                        "SUCCESS",
                        null,
                        "2026-06-07T00:15:00Z",
                        null,
                        List.of()
                )
        ));
        when(kestraClient.searchExecutions(searchFilter("g4-main"))).thenReturn(List.of(
                execution("created-newer", "g4-main", "main_job", "SUCCESS", "2026-06-07T00:30:00Z")
        ));

        OperationsExecutionListResponse response = service.listExecutions(4L, listQuery(
                null,
                null,
                null,
                FROM,
                TO
        ));

        assertThat(response.executions()).extracting("id").containsExactly("created-newer", "fallback-older");
    }

    @Test
    void listExecutions_exposesPlannedTimeAndPaginatesAfterFilteringAndSorting() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient);
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(List.of(syncConfig("main", "g4-main")));
        when(kestraClient.searchExecutions(searchFilter("g4-main"))).thenReturn(List.of(
                execution(
                        "newest",
                        "g4-main",
                        "hourly_policy",
                        "SUCCESS",
                        "2026-06-07T03:00:00Z",
                        "2026-06-07T03:10:00Z",
                        "2026-06-07T03:10:30Z",
                        "2026-06-07T03:11:00Z",
                        List.of()
                ),
                execution(
                        "middle",
                        "g4-main",
                        "hourly_policy",
                        "SUCCESS",
                        "2026-06-07T02:00:00Z",
                        "2026-06-07T02:00:10Z",
                        "2026-06-07T02:00:11Z",
                        "2026-06-07T02:01:00Z",
                        List.of()
                ),
                execution(
                        "oldest",
                        "g4-main",
                        "hourly_policy",
                        "SUCCESS",
                        "2026-06-07T01:00:00Z",
                        "2026-06-07T01:00:10Z",
                        "2026-06-07T01:00:12Z",
                        "2026-06-07T01:01:00Z",
                        List.of()
                )
        ));

        OperationsExecutionListResponse response = service.listExecutions(4L, listQuery(
                "main",
                "hourly",
                null,
                FROM,
                TO,
                2,
                2
        ));

        assertThat(response.page()).isEqualTo(2);
        assertThat(response.pageSize()).isEqualTo(2);
        assertThat(response.total()).isEqualTo(3);
        assertThat(response.totalPages()).isEqualTo(2);
        assertThat(response.executions()).extracting("id").containsExactly("oldest");
        assertThat(response.executions().getFirst().plannedAt()).isEqualTo(Instant.parse("2026-06-07T01:00:00Z"));
    }

    @Test
    void listExecutions_capsLargePageSizeAtOperationsMaximum() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient);
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(List.of(syncConfig("main", "g4-main")));
        when(kestraClient.searchExecutions(searchFilter("g4-main"))).thenReturn(List.of(
                execution("exec-main", "g4-main", "main_job", "SUCCESS", "2026-06-07T00:30:00Z")
        ));

        OperationsExecutionListResponse response = service.listExecutions(4L, listQuery(
                "main",
                null,
                null,
                FROM,
                TO,
                1,
                500
        ));

        assertThat(response.pageSize()).isEqualTo(200);
        assertThat(response.totalPages()).isEqualTo(1);
        assertThat(response.executions()).extracting("id").containsExactly("exec-main");
    }

    @Test
    void listExecutions_rejectsInvertedTimeRange() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient);

        assertThatThrownBy(() -> service.listExecutions(4L, listQuery(null, null, null, TO, FROM)))
                .isInstanceOfSatisfying(ResponseStatusException.class, exception -> {
                    assertThat(exception.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertThat(exception.getReason()).isEqualTo("时间范围不合法");
                });

        verify(gitSyncConfigService, never()).listEnabledSyncConfigs(Mockito.anyLong());
        verify(kestraClient, never()).searchExecutions(Mockito.any());
    }

    @Test
    void getExecution_rejectsExecutionsOutsideCurrentGroupScope() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient);
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(List.of(syncConfig("main", "g4-main")));
        when(kestraClient.getExecution("exec-g5")).thenReturn(execution("exec-g5", "g5-main", "daily", "FAILED", "2026-06-07T01:00:00Z"));

        assertThatThrownBy(() -> service.getExecution(4L, "exec-g5"))
                .isInstanceOfSatisfying(ResponseStatusException.class, exception -> {
                    assertThat(exception.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
                    assertThat(exception.getReason()).isEqualTo("执行记录不存在");
                });
    }

    @Test
    void getExecution_mapsTaskRunsInputsLabelsAndBranch() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient);
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(List.of(syncConfig("main", "g4-main")));
        KestraExecutionSnapshot execution = new KestraExecutionSnapshot(
                "exec-main",
                "g4-main",
                "daily",
                "FAILED",
                Instant.parse("2026-06-07T00:00:00Z"),
                Instant.parse("2026-06-07T01:00:00Z"),
                Instant.parse("2026-06-07T01:00:01Z"),
                Instant.parse("2026-06-07T01:00:06Z"),
                List.of(
                        taskRun("flow_dag", "SUCCESS", "2026-06-07T01:00:01Z", "2026-06-07T01:00:02Z"),
                        taskRun("parallel_root", "SUCCESS", "2026-06-07T01:00:01Z", "2026-06-07T01:00:02Z"),
                        taskRun("load", "FAILED", "2026-06-07T01:00:02Z", "2026-06-07T01:00:05Z")
                ),
                Map.of(
                        "date", "2026-06-07",
                        ExecutionTimeContext.PLANNED_TIME_INPUT, "2026-06-06T23:30:00Z"),
                Map.of("env", "prod")
        );
        when(kestraClient.getExecution("exec-main")).thenReturn(execution);

        OperationsExecutionDetailResponse response = service.getExecution(4L, "exec-main");

        assertThat(response.id()).isEqualTo("exec-main");
        assertThat(response.branch()).isEqualTo("main");
        assertThat(response.plannedAt()).isEqualTo(Instant.parse("2026-06-06T23:30:00Z"));
        assertThat(response.durationMs()).isEqualTo(5_000L);
        assertThat(response.rerunnable()).isTrue();
        assertThat(response.taskRuns()).hasSize(1);
        assertThat(response.taskRuns().getFirst().taskId()).isEqualTo("load");
        assertThat(response.taskRuns().getFirst().durationMs()).isEqualTo(3_000L);
        assertThat(response.inputs()).containsEntry("date", "2026-06-07");
        assertThat(response.labels()).containsEntry("env", "prod");
    }

    @Test
    void getExecutionResolvesScheduledParametersFromImmutableSnapshotAndPlannedTime() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        WbOperationExecutionActionMapper actionMapper = Mockito.mock(WbOperationExecutionActionMapper.class);
        ExecutionParameterSnapshotRegistry registry = Mockito.mock(ExecutionParameterSnapshotRegistry.class);
        OperationsExecutionService service = service(
                gitSyncConfigService, kestraClient, actionMapper, registry);
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(List.of(syncConfig("main", "g4-main")));
        KestraExecutionSnapshot scheduled = new KestraExecutionSnapshot(
                "exec-scheduled",
                "g4-main",
                "daily",
                "SUCCESS",
                Instant.parse("2026-06-07T00:00:00Z"),
                Instant.parse("2026-06-07T00:00:01Z"),
                Instant.parse("2026-06-07T00:00:02Z"),
                Instant.parse("2026-06-07T00:01:00Z"),
                List.of(),
                Map.of("name", "小明"),
                Map.of(
                        ExecutionParameterSnapshotRegistry.LABEL_KEY, "snapshot-1",
                        "wbdataParameterOverrideKeys", "__none__")
        );
        FlowParameterSnapshot snapshot = new FlowParameterSnapshot(2, "Asia/Shanghai", "daily", 3, List.of(
                new FlowParameterDefinitionSnapshot(
                        "name", "CONSTANT", "小明", null, 0, null, 0, null),
                new FlowParameterDefinitionSnapshot(
                        "v_day", "SYSTEM_TIME", null, "yyyyMMdd", -1, null, 1, "PLANNED_TIME")
        ));
        when(kestraClient.getExecution("exec-scheduled")).thenReturn(scheduled);
        when(registry.find(4L, "snapshot-1")).thenReturn(java.util.Optional.of(snapshot));

        OperationsExecutionDetailResponse detail = service.getExecution(4L, "exec-scheduled");

        assertThat(detail.parameterResolutionStatus()).isEqualTo("AVAILABLE");
        assertThat(detail.parameters())
                .extracting(parameter -> parameter.key() + "=" + parameter.value() + ":" + parameter.source())
                .containsExactly("name=小明:CONSTANT", "v_day=20260606:SYSTEM_TIME");
    }

    @Test
    void getLogs_validatesExecutionScopeBeforeFetchingLogs() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient);
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(List.of(syncConfig("main", "g4-main")));
        when(kestraClient.getExecution("exec-main")).thenReturn(execution("exec-main", "g4-main", "daily", "FAILED", "2026-06-07T01:00:00Z"));
        when(kestraClient.getLogs("exec-main", null)).thenReturn(Arrays.asList(
                null,
                new KestraLogEntry(Instant.parse("2026-06-07T01:00:03Z"), "load", "ERROR", "failed")
        ));

        var logs = service.getLogs(4L, "exec-main", "   ");

        assertThat(logs).hasSize(1);
        assertThat(logs.getFirst().taskId()).isEqualTo("load");
        assertThat(logs.getFirst().message()).isEqualTo("failed");
        verify(kestraClient).getLogs("exec-main", null);
    }

    @Test
    void getLogs_rejectsInaccessibleExecutionBeforeFetchingLogs() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient);
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(List.of(syncConfig("main", "g4-main")));
        when(kestraClient.getExecution("exec-g5")).thenReturn(execution("exec-g5", "g5-main", "daily", "FAILED", "2026-06-07T01:00:00Z"));

        assertThatThrownBy(() -> service.getLogs(4L, "exec-g5", null))
                .isInstanceOfSatisfying(ResponseStatusException.class, exception -> {
                    assertThat(exception.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
                    assertThat(exception.getReason()).isEqualTo("执行记录不存在");
                });

        verify(kestraClient, never()).getLogs(Mockito.anyString(), Mockito.any());
    }

    @Test
    void rerunExecution_allowsFailedTerminalStatusAndWritesAudit() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        WbOperationExecutionActionMapper actionMapper = Mockito.mock(WbOperationExecutionActionMapper.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient, actionMapper);
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(List.of(syncConfig("main", "g4-main")));
        when(kestraClient.getExecution("exec-main")).thenReturn(execution("exec-main", "g4-main", "daily", "FAILED", "2026-06-07T01:00:00Z"));
        when(kestraClient.createExecution(
                Mockito.eq("g4-main"), Mockito.eq("daily"), Mockito.anyMap(), Mockito.anyMap()))
                .thenReturn(execution("rerun-1", "g4-main-rerun", "daily_rerun", "CREATED", "2026-06-07T01:05:00Z"));
        when(actionMapper.insert(Mockito.any())).thenReturn(1);

        OperationsExecutionRerunResponse response = service.rerunExecution(4L, 9L, "exec-main", false);

        assertThat(response.originalExecutionId()).isEqualTo("exec-main");
        assertThat(response.newExecutionId()).isEqualTo("rerun-1");
        assertThat(response.namespace()).isEqualTo("g4-main-rerun");
        assertThat(response.flowId()).isEqualTo("daily_rerun");
        assertThat(response.status()).isEqualTo("CREATED");
        assertThat(response.createdAt()).isEqualTo(Instant.parse("2026-06-07T01:05:00Z"));

        ArgumentCaptor<WbOperationExecutionAction> captor = ArgumentCaptor.forClass(WbOperationExecutionAction.class);
        verify(actionMapper).insert(captor.capture());
        assertThat(captor.getValue().getGroupId()).isEqualTo(4L);
        assertThat(captor.getValue().getActionType()).isEqualTo("RERUN");
        assertThat(captor.getValue().getRequestedBy()).isEqualTo(9L);
        assertThat(captor.getValue().getOriginalExecutionId()).isEqualTo("exec-main");
        assertThat(captor.getValue().getNewExecutionId()).isEqualTo("rerun-1");
        assertThat(captor.getValue().getNamespace()).isEqualTo("g4-main");
        assertThat(captor.getValue().getFlowId()).isEqualTo("daily");
        assertThat(captor.getValue().getRequestedAt()).isNotNull();
        verify(kestraClient).createExecution(
                "g4-main",
                "daily",
                Map.of(),
                Map.of("wbdataParameterOverrideKeys", "__none__"));
    }

    @Test
    void rerunExecutionPreservesPlannedContextButRecomputesParameterValues() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        WbOperationExecutionActionMapper actionMapper = Mockito.mock(WbOperationExecutionActionMapper.class);
        ExecutionParameterSnapshotRegistry registry = Mockito.mock(ExecutionParameterSnapshotRegistry.class);
        OperationsExecutionService service = service(
                gitSyncConfigService, kestraClient, actionMapper, registry);
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(List.of(syncConfig("main", "g4-main")));
        KestraExecutionSnapshot original = new KestraExecutionSnapshot(
                "exec-main",
                "g4-main",
                "daily",
                "FAILED",
                Instant.parse("2026-06-07T00:00:00Z"),
                Instant.parse("2026-06-07T00:00:01Z"),
                Instant.parse("2026-06-07T00:00:02Z"),
                Instant.parse("2026-06-07T00:01:00Z"),
                List.of(),
                Map.of("name", "李雷"),
                Map.of(
                        ExecutionParameterSnapshotRegistry.LABEL_KEY, "snapshot-1",
                        "wbdataParameterOverrideKeys", "name")
        );
        FlowParameterSnapshot snapshot = new FlowParameterSnapshot(2, "Asia/Shanghai", "daily", 3, List.of(
                new FlowParameterDefinitionSnapshot(
                        "name", "CONSTANT", "小明", null, 0, null, 0, null),
                new FlowParameterDefinitionSnapshot(
                        "v_day", "SYSTEM_TIME", null, "yyyyMMdd", -1, null, 1, "PLANNED_TIME")
        ));
        when(kestraClient.getExecution("exec-main")).thenReturn(original);
        when(kestraClient.getFlowSource("g4-main", "daily")).thenReturn("""
                id: daily
                namespace: g4-main
                labels:
                  wbdataParameterSnapshotId: snapshot-1
                tasks: []
                """);
        when(registry.find(4L, "snapshot-1")).thenReturn(java.util.Optional.of(snapshot));
        when(kestraClient.createExecution(
                Mockito.eq("g4-main"), Mockito.eq("daily"), Mockito.anyMap(), Mockito.anyMap()))
                .thenReturn(execution("rerun-1", "g4-main", "daily", "CREATED", "2026-06-07T01:05:00Z"));
        when(actionMapper.insert(Mockito.any())).thenReturn(1);

        service.rerunExecution(4L, 9L, "exec-main", false);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, String>> inputs = ArgumentCaptor.forClass(Map.class);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, String>> labels = ArgumentCaptor.forClass(Map.class);
        verify(kestraClient).createExecution(
                Mockito.eq("g4-main"), Mockito.eq("daily"), inputs.capture(), labels.capture());
        assertThat(inputs.getValue()).containsExactly(
                Map.entry(ExecutionTimeContext.PLANNED_TIME_INPUT, "2026-06-07T00:00:00Z")
        );
        assertThat(labels.getValue()).containsExactly(
                Map.entry("wbdataParameterOverrideKeys", "__none__"));
    }

    @Test
    void rerunExecutionReusesManualOverridesOnlyWhenExplicitlyRequested() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        WbOperationExecutionActionMapper actionMapper = Mockito.mock(WbOperationExecutionActionMapper.class);
        ExecutionParameterSnapshotRegistry registry = Mockito.mock(ExecutionParameterSnapshotRegistry.class);
        OperationsExecutionService service = service(
                gitSyncConfigService, kestraClient, actionMapper, registry);
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(List.of(syncConfig("main", "g4-main")));
        KestraExecutionSnapshot original = new KestraExecutionSnapshot(
                "exec-main", "g4-main", "daily", "FAILED",
                Instant.parse("2026-06-07T00:00:00Z"),
                Instant.parse("2026-06-07T00:00:01Z"),
                Instant.parse("2026-06-07T00:00:02Z"),
                Instant.parse("2026-06-07T00:01:00Z"),
                List.of(),
                Map.of("name", "李雷"),
                Map.of(
                        ExecutionParameterSnapshotRegistry.LABEL_KEY, "snapshot-1",
                        "wbdataParameterOverrideKeys", "name"));
        FlowParameterSnapshot snapshot = new FlowParameterSnapshot(2, "Asia/Shanghai", "daily", 3, List.of(
                new FlowParameterDefinitionSnapshot(
                        "name", "CONSTANT", "小明", null, 0, null, 0, null),
                new FlowParameterDefinitionSnapshot(
                        "v_day", "SYSTEM_TIME", null, "yyyyMMdd", -1, null, 1, "PLANNED_TIME")));
        when(kestraClient.getExecution("exec-main")).thenReturn(original);
        when(kestraClient.getFlowSource("g4-main", "daily")).thenReturn("""
                id: daily
                namespace: g4-main
                labels:
                  wbdataParameterSnapshotId: snapshot-1
                tasks: []
                """);
        when(registry.find(4L, "snapshot-1")).thenReturn(java.util.Optional.of(snapshot));
        when(kestraClient.createExecution(
                Mockito.eq("g4-main"), Mockito.eq("daily"), Mockito.anyMap(), Mockito.anyMap()))
                .thenReturn(execution("rerun-1", "g4-main", "daily", "CREATED", "2026-06-07T01:05:00Z"));
        when(actionMapper.insert(Mockito.any())).thenReturn(1);

        service.rerunExecution(4L, 9L, "exec-main", true);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, String>> inputs = ArgumentCaptor.forClass(Map.class);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, String>> labels = ArgumentCaptor.forClass(Map.class);
        verify(kestraClient).createExecution(
                Mockito.eq("g4-main"), Mockito.eq("daily"), inputs.capture(), labels.capture());
        assertThat(inputs.getValue()).containsExactlyInAnyOrderEntriesOf(Map.of(
                "name", "李雷",
                ExecutionTimeContext.PLANNED_TIME_INPUT, "2026-06-07T00:00:00Z"));
        assertThat(labels.getValue()).containsExactly(
                Map.entry("wbdataParameterOverrideKeys", "name"));
    }

    @Test
    void rerunExecutionUsesCurrentParameterSnapshotWhenSnapshotChanged() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        WbOperationExecutionActionMapper actionMapper = Mockito.mock(WbOperationExecutionActionMapper.class);
        ExecutionParameterSnapshotRegistry registry = Mockito.mock(ExecutionParameterSnapshotRegistry.class);
        OperationsExecutionService service = service(
                gitSyncConfigService, kestraClient, actionMapper, registry);
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(List.of(syncConfig("main", "g4-main")));
        KestraExecutionSnapshot original = new KestraExecutionSnapshot(
                "exec-main", "g4-main", "daily", "FAILED",
                Instant.parse("2026-06-07T00:00:00Z"),
                Instant.parse("2026-06-07T00:00:01Z"),
                Instant.parse("2026-06-07T00:00:02Z"),
                Instant.parse("2026-06-07T00:01:00Z"),
                List.of(), Map.of("name", "小明"),
                Map.of(ExecutionParameterSnapshotRegistry.LABEL_KEY, "snapshot-old"));
        FlowParameterSnapshot currentSnapshot = new FlowParameterSnapshot(2, "Asia/Shanghai", "daily", 4, List.of(
                new FlowParameterDefinitionSnapshot(
                        "v_day", "SYSTEM_TIME", null, "yyyyMMdd", -1, null, 0, "PLANNED_TIME")));
        when(kestraClient.getExecution("exec-main")).thenReturn(original);
        when(kestraClient.getFlowSource("g4-main", "daily")).thenReturn("""
                id: daily
                namespace: g4-main
                labels:
                  wbdataParameterSnapshotId: snapshot-new
                tasks: []
                """);
        when(registry.find(4L, "snapshot-new")).thenReturn(java.util.Optional.of(currentSnapshot));
        when(kestraClient.createExecution(
                Mockito.eq("g4-main"), Mockito.eq("daily"), Mockito.anyMap(), Mockito.anyMap()))
                .thenReturn(execution("rerun-1", "g4-main", "daily", "CREATED", "2026-06-07T01:05:00Z"));
        when(actionMapper.insert(Mockito.any())).thenReturn(1);

        service.rerunExecution(4L, 9L, "exec-main", false);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, String>> inputs = ArgumentCaptor.forClass(Map.class);
        verify(kestraClient).createExecution(
                Mockito.eq("g4-main"), Mockito.eq("daily"), inputs.capture(), Mockito.anyMap());
        assertThat(inputs.getValue()).containsExactly(
                Map.entry(ExecutionTimeContext.PLANNED_TIME_INPUT, "2026-06-07T00:00:00Z"));
    }

    @Test
    void rerunExecution_rejectsSuccessStatus() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        WbOperationExecutionActionMapper actionMapper = Mockito.mock(WbOperationExecutionActionMapper.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient, actionMapper);
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(List.of(syncConfig("main", "g4-main")));
        when(kestraClient.getExecution("exec-main")).thenReturn(execution("exec-main", "g4-main", "daily", "SUCCESS", "2026-06-07T01:00:00Z"));

        assertThatThrownBy(() -> service.rerunExecution(4L, 9L, "exec-main", false))
                .isInstanceOfSatisfying(ResponseStatusException.class, exception -> {
                    assertThat(exception.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertThat(exception.getReason()).isEqualTo("当前状态不支持重跑");
                });

        verify(kestraClient, never()).createExecution(
                Mockito.anyString(), Mockito.anyString(), Mockito.anyMap(), Mockito.anyMap());
        verify(actionMapper, never()).insert(Mockito.any());
    }

    @Test
    void rerunExecution_killsCreatedExecutionWhenAuditInsertFails() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        WbOperationExecutionActionMapper actionMapper = Mockito.mock(WbOperationExecutionActionMapper.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient, actionMapper);
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(List.of(syncConfig("main", "g4-main")));
        when(kestraClient.getExecution("exec-main")).thenReturn(execution("exec-main", "g4-main", "daily", "FAILED", "2026-06-07T01:00:00Z"));
        when(kestraClient.createExecution(
                Mockito.eq("g4-main"), Mockito.eq("daily"), Mockito.anyMap(), Mockito.anyMap()))
                .thenReturn(execution("rerun-1", "g4-main", "daily", "CREATED", "2026-06-07T01:05:00Z"));
        when(actionMapper.insert(Mockito.any())).thenThrow(new IllegalStateException("audit failed"));

        assertThatThrownBy(() -> service.rerunExecution(4L, 9L, "exec-main", false))
                .isInstanceOfSatisfying(ResponseStatusException.class, exception -> {
                    assertThat(exception.getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
                    assertThat(exception.getReason()).isEqualTo("重跑审计记录写入失败，已尝试停止新执行");
                });

        verify(kestraClient).killExecution("rerun-1");
    }

    @Test
    void rerunExecution_killsCreatedExecutionWhenAuditInsertReturnsZero() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        WbOperationExecutionActionMapper actionMapper = Mockito.mock(WbOperationExecutionActionMapper.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient, actionMapper);
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(List.of(syncConfig("main", "g4-main")));
        when(kestraClient.getExecution("exec-main")).thenReturn(execution("exec-main", "g4-main", "daily", "FAILED", "2026-06-07T01:00:00Z"));
        when(kestraClient.createExecution(
                Mockito.eq("g4-main"), Mockito.eq("daily"), Mockito.anyMap(), Mockito.anyMap()))
                .thenReturn(execution("rerun-1", "g4-main", "daily", "CREATED", "2026-06-07T01:05:00Z"));
        when(actionMapper.insert(Mockito.any())).thenReturn(0);

        assertThatThrownBy(() -> service.rerunExecution(4L, 9L, "exec-main", false))
                .isInstanceOfSatisfying(ResponseStatusException.class, exception -> {
                    assertThat(exception.getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
                    assertThat(exception.getReason()).isEqualTo("重跑审计记录写入失败，已尝试停止新执行");
                });

        verify(kestraClient).killExecution("rerun-1");
    }

    private static OperationsExecutionService service(GitSyncConfigService gitSyncConfigService,
                                                      KestraClient kestraClient) {
        return service(gitSyncConfigService, kestraClient, Mockito.mock(WbOperationExecutionActionMapper.class));
    }

    private static OperationsExecutionService service(GitSyncConfigService gitSyncConfigService,
                                                      KestraClient kestraClient,
                                                      WbOperationExecutionActionMapper actionMapper) {
        return service(
                gitSyncConfigService,
                kestraClient,
                actionMapper,
                Mockito.mock(ExecutionParameterSnapshotRegistry.class)
        );
    }

    private static OperationsExecutionService service(GitSyncConfigService gitSyncConfigService,
                                                      KestraClient kestraClient,
                                                      WbOperationExecutionActionMapper actionMapper,
                                                      ExecutionParameterSnapshotRegistry registry) {
        return new OperationsExecutionService(
                gitSyncConfigService,
                kestraClient,
                actionMapper,
                registry
        );
    }

    private static List<GitSyncConfigResponse> syncConfigs() {
        return List.of(
                syncConfig("feature/policy-review", "g4-feature-policy-review"),
                syncConfig("main", "g4-main")
        );
    }

    private static OperationsExecutionQuery listQuery(String branch,
                                                      String flowId,
                                                      String status,
                                                      Instant from,
                                                      Instant to) {
        return listQuery(branch, flowId, status, from, to, null, null);
    }

    private static OperationsExecutionQuery listQuery(String branch,
                                                      String flowId,
                                                      String status,
                                                      Instant from,
                                                      Instant to,
                                                      Integer page,
                                                      Integer pageSize) {
        return new OperationsExecutionQuery(branch, flowId, status, from, to, page, pageSize);
    }

    private static GitSyncConfigResponse syncConfig(String branch, String namespace) {
        return new GitSyncConfigResponse(
                1L,
                4L,
                branch,
                namespace,
                "sync-flows-" + namespace,
                true,
                LocalDateTime.parse("2026-06-07T00:00:00"),
                null,
                null
        );
    }

    private static Map<String, String> searchFilter(String namespace) {
        return searchFilter(namespace, FROM.toString(), TO.toString());
    }

    private static Map<String, String> searchFilter(String namespace, String from, String to) {
        Map<String, String> filters = new LinkedHashMap<>();
        filters.put("filters[namespace][EQUALS]", namespace);
        filters.put("startDate", from);
        filters.put("endDate", to);
        return filters;
    }

    private static KestraExecutionSnapshot execution(String id,
                                                     String namespace,
                                                     String flowId,
                                                     String status,
                                                     String createdAt) {
        return execution(id, namespace, flowId, status, createdAt, "2026-06-07T00:00:00Z", null, List.of());
    }

    private static KestraExecutionSnapshot execution(String id,
                                                     String namespace,
                                                     String flowId,
                                                     String status,
                                                     String createdAt,
                                                     String startDate,
                                                     String endDate,
                                                     List<KestraTaskRunSnapshot> taskRuns) {
        return execution(id, namespace, flowId, status, null, createdAt, startDate, endDate, taskRuns);
    }

    private static KestraExecutionSnapshot execution(String id,
                                                     String namespace,
                                                     String flowId,
                                                     String status,
                                                     String plannedAt,
                                                     String createdAt,
                                                     String startDate,
                                                     String endDate,
                                                     List<KestraTaskRunSnapshot> taskRuns) {
        return new KestraExecutionSnapshot(
                id,
                namespace,
                flowId,
                status,
                plannedAt == null ? null : Instant.parse(plannedAt),
                createdAt == null ? null : Instant.parse(createdAt),
                startDate == null ? null : Instant.parse(startDate),
                endDate == null ? null : Instant.parse(endDate),
                taskRuns,
                Map.of(),
                Map.of()
        );
    }

    private static KestraTaskRunSnapshot taskRun(String taskId, String status) {
        return new KestraTaskRunSnapshot(taskId, status, null, null);
    }

    private static KestraTaskRunSnapshot taskRun(String taskId, String status, String startDate, String endDate) {
        return new KestraTaskRunSnapshot(taskId, status, Instant.parse(startDate), Instant.parse(endDate));
    }
}
