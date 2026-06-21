package com.wbdata.operations.service;

import com.wbdata.git.dto.GitSyncConfigResponse;
import com.wbdata.git.service.GitSyncConfigService;
import com.wbdata.offline.service.KestraClient;
import com.wbdata.offline.service.KestraExecutionSnapshot;
import com.wbdata.offline.service.KestraLogEntry;
import com.wbdata.offline.service.KestraTaskRunSnapshot;
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
                        "createdAt", "startDate", "endDate", "durationMs", "rerunnable"
                );
        assertThat(Arrays.stream(OperationsExecutionDetailResponse.class.getRecordComponents())
                .map(component -> component.getName()))
                .containsExactly(
                        "id", "namespace", "flowId", "branch", "status",
                        "createdAt", "startDate", "endDate", "durationMs", "rerunnable",
                        "taskRuns", "inputs", "labels"
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

        OperationsExecutionListResponse response = service.listExecutions(4L, new OperationsExecutionQuery(
                null,
                null,
                null,
                FROM,
                TO
        ));

        assertThat(response.branches()).containsExactly("feature/policy-review", "main");
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

        OperationsExecutionListResponse response = service.listExecutions(4L, new OperationsExecutionQuery(
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

        service.listExecutions(4L, new OperationsExecutionQuery(
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

        OperationsExecutionListResponse response = service.listExecutions(4L, new OperationsExecutionQuery(
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

        OperationsExecutionListResponse response = service.listExecutions(4L, new OperationsExecutionQuery(
                null,
                null,
                null,
                FROM,
                TO
        ));

        assertThat(response.executions()).extracting("id").containsExactly("created-newer", "fallback-older");
    }

    @Test
    void listExecutions_rejectsInvertedTimeRange() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient);

        assertThatThrownBy(() -> service.listExecutions(4L, new OperationsExecutionQuery(null, null, null, TO, FROM)))
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
                Instant.parse("2026-06-07T01:00:00Z"),
                Instant.parse("2026-06-07T01:00:01Z"),
                Instant.parse("2026-06-07T01:00:06Z"),
                List.of(taskRun("load", "FAILED", "2026-06-07T01:00:02Z", "2026-06-07T01:00:05Z")),
                Map.of("date", "2026-06-07"),
                Map.of("env", "prod")
        );
        when(kestraClient.getExecution("exec-main")).thenReturn(execution);

        OperationsExecutionDetailResponse response = service.getExecution(4L, "exec-main");

        assertThat(response.id()).isEqualTo("exec-main");
        assertThat(response.branch()).isEqualTo("main");
        assertThat(response.durationMs()).isEqualTo(5_000L);
        assertThat(response.rerunnable()).isTrue();
        assertThat(response.taskRuns()).hasSize(1);
        assertThat(response.taskRuns().getFirst().taskId()).isEqualTo("load");
        assertThat(response.taskRuns().getFirst().durationMs()).isEqualTo(3_000L);
        assertThat(response.inputs()).containsEntry("date", "2026-06-07");
        assertThat(response.labels()).containsEntry("env", "prod");
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
        when(kestraClient.createExecution("g4-main", "daily")).thenReturn(execution("rerun-1", "g4-main-rerun", "daily_rerun", "CREATED", "2026-06-07T01:05:00Z"));
        when(actionMapper.insert(Mockito.any())).thenReturn(1);

        OperationsExecutionRerunResponse response = service.rerunExecution(4L, 9L, "exec-main");

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
    }

    @Test
    void rerunExecution_rejectsSuccessStatus() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        WbOperationExecutionActionMapper actionMapper = Mockito.mock(WbOperationExecutionActionMapper.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient, actionMapper);
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(List.of(syncConfig("main", "g4-main")));
        when(kestraClient.getExecution("exec-main")).thenReturn(execution("exec-main", "g4-main", "daily", "SUCCESS", "2026-06-07T01:00:00Z"));

        assertThatThrownBy(() -> service.rerunExecution(4L, 9L, "exec-main"))
                .isInstanceOfSatisfying(ResponseStatusException.class, exception -> {
                    assertThat(exception.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertThat(exception.getReason()).isEqualTo("当前状态不支持重跑");
                });

        verify(kestraClient, never()).createExecution(Mockito.anyString(), Mockito.anyString());
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
        when(kestraClient.createExecution("g4-main", "daily")).thenReturn(execution("rerun-1", "g4-main", "daily", "CREATED", "2026-06-07T01:05:00Z"));
        when(actionMapper.insert(Mockito.any())).thenThrow(new IllegalStateException("audit failed"));

        assertThatThrownBy(() -> service.rerunExecution(4L, 9L, "exec-main"))
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
        when(kestraClient.createExecution("g4-main", "daily")).thenReturn(execution("rerun-1", "g4-main", "daily", "CREATED", "2026-06-07T01:05:00Z"));
        when(actionMapper.insert(Mockito.any())).thenReturn(0);

        assertThatThrownBy(() -> service.rerunExecution(4L, 9L, "exec-main"))
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
        return new OperationsExecutionService(
                gitSyncConfigService,
                kestraClient,
                actionMapper
        );
    }

    private static List<GitSyncConfigResponse> syncConfigs() {
        return List.of(
                syncConfig("feature/policy-review", "g4-feature-policy-review"),
                syncConfig("main", "g4-main")
        );
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
        return new KestraExecutionSnapshot(
                id,
                namespace,
                flowId,
                status,
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
