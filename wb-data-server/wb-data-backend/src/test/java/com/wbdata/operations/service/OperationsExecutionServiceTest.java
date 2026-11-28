package com.wbdata.operations.service;

import com.wbdata.git.dto.GitSyncConfigResponse;
import com.wbdata.git.service.GitSyncConfigService;
import com.wbdata.group.dto.GroupOwnerInfo;
import com.wbdata.group.service.GroupOwnerService;
import com.wbdata.offline.entity.WbOfflineFlowIndex;
import com.wbdata.offline.service.OfflineFlowIndexService;
import com.wbdata.offline.kestra.KestraClient;
import com.wbdata.offline.kestra.KestraExecutionPage;
import com.wbdata.offline.kestra.KestraExecutionSnapshot;
import com.wbdata.offline.kestra.KestraLogEntry;
import com.wbdata.offline.kestra.KestraTaskRunSnapshot;
import com.wbdata.offline.parameter.service.ExecutionParameterSnapshotRegistry;
import com.wbdata.offline.parameter.service.ExecutionTimeContext;
import com.wbdata.offline.parameter.dto.FlowParameterDefinitionSnapshot;
import com.wbdata.offline.parameter.dto.FlowParameterSnapshot;
import com.wbdata.operations.dto.OperationsExecutionDetailResponse;
import com.wbdata.operations.dto.OperationsExecutionListItem;
import com.wbdata.operations.dto.OperationsExecutionListResponse;
import com.wbdata.operations.dto.OperationsExecutionQuery;
import com.wbdata.operations.dto.OperationsExecutionRerunContextResponse;
import com.wbdata.operations.dto.OperationsExecutionRerunResponse;
import com.wbdata.operations.dto.OperationsExecutionStatusCounts;
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
                        "plannedAt", "createdAt", "startDate", "endDate", "durationMs",
                        "rerunnable", "stoppable", "rerun", "rerunType", "retryAttempt",
                        "partialRerun", "rerunSelectedTaskCount", "rerunTotalTaskCount",
                        "markableSuccess", "ownerUserId", "ownerName", "ownerUsername", "ownerStatus"
                );
        assertThat(Arrays.stream(OperationsExecutionDetailResponse.class.getRecordComponents())
                .map(component -> component.getName()))
                .containsExactly(
                        "id", "namespace", "flowId", "branch", "status",
                        "plannedAt", "createdAt", "startDate", "endDate", "durationMs",
                        "rerunnable", "stoppable", "taskRuns", "inputs", "labels",
                        "parameterResolutionStatus", "parameters", "parameterSnapshotChanged",
                        "rerun", "rerunType", "retryAttempt",
                        "partialRerun", "rerunSelectedTaskCount", "rerunTotalTaskCount",
                        "markableSuccess", "forceSuccess", "forceSuccessBy", "forceSuccessAt"
                );
        assertThat(Arrays.stream(OperationsExecutionListResponse.class.getRecordComponents())
                .map(component -> component.getName()))
                .containsExactly(
                        "branches", "selectedBranch", "from", "to",
                        "page", "pageSize", "total", "totalPages", "executions", "statusCounts"
                );
    }

    @Test
    void listExecutions_returnsOnlyCurrentGroupBusinessNamespaces() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient);
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(syncConfigs());
        stubPagedSearch(kestraClient, List.of(
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
                execution("exec-sync", "g4-feature-policy-review", "sync-flows-g4-feature-policy-review", "SUCCESS", "2026-06-07T00:20:00Z"),
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
        verify(kestraClient).searchExecutionsPage(
                searchFilterIn("g4-feature-policy-review,g4-main", FROM.toString(), TO.toString()),
                1, 50, "state.startDate:desc");
        verify(kestraClient, never()).searchExecutions(Mockito.any());
    }

    @Test
    void listExecutions_appliesBranchFlowStatusAndTimeFilters() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient);
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(syncConfigs());
        stubPagedSearch(kestraClient, List.of(
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
        Map<String, String> expectedFilters = searchFilter("g4-feature-policy-review");
        expectedFilters.put("filters[flowId][REGEX]", "(?i).*daily.*");
        expectedFilters.put("filters[state][EQUALS]", "FAILED");
        verify(kestraClient).searchExecutionsPage(expectedFilters, 1, 50, "state.startDate:desc");
        verify(kestraClient, never()).searchExecutionsPage(
                Mockito.argThat(filters -> "g4-main".equals(filters.get("filters[namespace][EQUALS]"))),
                Mockito.anyInt(), Mockito.anyInt(), Mockito.any());
    }

    @Test
    void listExecutions_truncatesKestraSearchTimeRangeToMilliseconds() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient);
        Instant from = Instant.parse("2026-06-06T00:00:00.123456Z");
        Instant to = Instant.parse("2026-06-08T00:00:00.987654Z");
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(List.of(syncConfig("main", "g4-main")));
        stubPagedSearch(kestraClient, List.of());

        service.listExecutions(4L, listQuery(
                "main",
                null,
                null,
                from,
                to
        ));

        verify(kestraClient).searchExecutionsPage(searchFilter(
                "g4-main",
                "2026-06-06T00:00:00.123Z",
                "2026-06-08T00:00:00.987Z"
        ), 1, 50, "state.startDate:desc");
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
        verify(kestraClient, never()).searchExecutionsPage(Mockito.any(), Mockito.anyInt(), Mockito.anyInt(), Mockito.any());
    }

    @Test
    void listExecutions_sortsByCreatedAtFallbackToStartDateDescending() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient);
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(syncConfigs());
        stubPagedSearch(kestraClient, List.of(
                execution(
                        "fallback-older",
                        "g4-feature-policy-review",
                        "daily_policy",
                        "SUCCESS",
                        null,
                        "2026-06-07T00:15:00Z",
                        null,
                        List.of()
                ),
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
        verify(kestraClient).searchExecutionsPage(
                searchFilterIn("g4-feature-policy-review,g4-main", FROM.toString(), TO.toString()),
                1, 50, "state.startDate:desc");
    }

    @Test
    void listExecutions_exposesPlannedTimeAndPaginatesAfterFilteringAndSorting() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient);
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(List.of(syncConfig("main", "g4-main")));
        stubPagedSearch(kestraClient, List.of(
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
        stubPagedSearch(kestraClient, List.of(
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
    void listExecutions_escapesRegexMetacharactersInFlowIdFilter() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient);
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(List.of(syncConfig("main", "g4-main")));
        stubPagedSearch(kestraClient, List.of(
                execution("exec-special", "g4-main", "ods.crm[1]+test", "SUCCESS", "2026-06-07T01:00:00Z")
        ));

        OperationsExecutionListResponse response = service.listExecutions(4L, listQuery(
                "main",
                "ods.crm[1]+test",
                null,
                FROM,
                TO
        ));

        assertThat(response.executions()).extracting("id").containsExactly("exec-special");
        Map<String, String> expectedFilters = searchFilter("g4-main");
        expectedFilters.put("filters[flowId][REGEX]", "(?i).*ods\\.crm\\[1\\]\\+test.*");
        verify(kestraClient).searchExecutionsPage(expectedFilters, 1, 50, "state.startDate:desc");
    }

    @Test
    void listExecutions_clampsOutOfRangePageAndRefetchesLastPage() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient);
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(List.of(syncConfig("main", "g4-main")));
        stubPagedSearch(kestraClient, List.of(
                execution("newest", "g4-main", "hourly", "SUCCESS", "2026-06-07T03:00:00Z"),
                execution("middle", "g4-main", "hourly", "SUCCESS", "2026-06-07T02:00:00Z"),
                execution("oldest", "g4-main", "hourly", "SUCCESS", "2026-06-07T01:00:00Z")
        ));

        OperationsExecutionListResponse response = service.listExecutions(4L, listQuery(
                "main",
                null,
                null,
                FROM,
                TO,
                5,
                2
        ));

        assertThat(response.page()).isEqualTo(2);
        assertThat(response.total()).isEqualTo(3);
        assertThat(response.totalPages()).isEqualTo(2);
        assertThat(response.statusCounts().total()).isEqualTo(3);
        assertThat(response.executions()).extracting("id").containsExactly("oldest");
        Map<String, String> base = searchFilter("g4-main");
        verify(kestraClient).searchExecutionsPage(base, 5, 2, "state.startDate:desc");
        verify(kestraClient).searchExecutionsPage(base, 1, 2, "state.startDate:desc");
        verify(kestraClient).searchExecutionsPage(base, 2, 2, "state.startDate:desc");

        Mockito.clearInvocations(kestraClient);
        OperationsExecutionListResponse singlePageResponse = service.listExecutions(4L, listQuery(
                "main",
                null,
                null,
                FROM,
                TO,
                5,
                5
        ));
        assertThat(singlePageResponse.page()).isEqualTo(1);
        assertThat(singlePageResponse.total()).isEqualTo(3);
        assertThat(singlePageResponse.totalPages()).isEqualTo(1);
        assertThat(singlePageResponse.executions()).extracting("id").containsExactly("newest", "middle", "oldest");
        verify(kestraClient, Mockito.times(1)).searchExecutionsPage(base, 1, 5, "state.startDate:desc");
    }

    @Test
    void listExecutions_reusesMainPageTotalWithoutDuplicateCountQuery() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient);
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(List.of(syncConfig("main", "g4-main")));
        stubPagedSearch(kestraClient, List.of(
                execution("exec-fail", "g4-main", "daily", "FAILED", "2026-06-07T01:00:00Z"),
                execution("exec-ok", "g4-main", "daily", "SUCCESS", "2026-06-07T00:50:00Z")
        ));

        service.listExecutions(4L, listQuery("main", null, null, FROM, TO));
        Map<String, String> base = searchFilter("g4-main");
        verify(kestraClient, never()).searchExecutionsPage(base, 1, 1, null);

        Mockito.clearInvocations(kestraClient);
        service.listExecutions(4L, listQuery("main", null, "FAILED", FROM, TO));
        Map<String, String> failedFilters = new LinkedHashMap<>(base);
        failedFilters.put("filters[state][EQUALS]", "FAILED");
        verify(kestraClient).searchExecutionsPage(failedFilters, 1, 50, "state.startDate:desc");
        verify(kestraClient, never()).searchExecutionsPage(failedFilters, 1, 1, null);
        verify(kestraClient).searchExecutionsPage(base, 1, 1, null);
    }

    @Test
    void listExecutions_unknownStatusSkipsPageQueryWhileComputingStatusCounts() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient);
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(List.of(syncConfig("main", "g4-main")));
        stubPagedSearch(kestraClient, List.of(
                execution("exec-ok", "g4-main", "daily", "SUCCESS", "2026-06-07T01:00:00Z"),
                execution("exec-fail", "g4-main", "daily", "FAILED", "2026-06-07T00:50:00Z")
        ));

        OperationsExecutionListResponse response = service.listExecutions(4L, listQuery(
                "main",
                null,
                "BOGUS",
                FROM,
                TO
        ));

        assertThat(response.total()).isZero();
        assertThat(response.totalPages()).isZero();
        assertThat(response.executions()).isEmpty();
        assertThat(response.statusCounts()).isEqualTo(new OperationsExecutionStatusCounts(2, 1, 1, 0, 0));
        verify(kestraClient, never()).searchExecutionsPage(
                Mockito.argThat(filters -> "BOGUS".equals(filters.get("filters[state][EQUALS]"))),
                Mockito.anyInt(), Mockito.anyInt(), Mockito.any());
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
        verify(kestraClient, never()).searchExecutionsPage(Mockito.any(), Mockito.anyInt(), Mockito.anyInt(), Mockito.any());
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
                Map.of("env", "prod"),
                Map.of()
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
                        "wbdataParameterOverrideKeys", "__none__"),
                Map.of()
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
                        "wbdataParameterOverrideKeys", "name"),
                Map.of()
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
    void rerunExecution_forwardsPlannedTimeForGatedFlowWithoutParameterSnapshot() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        WbOperationExecutionActionMapper actionMapper = Mockito.mock(WbOperationExecutionActionMapper.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient, actionMapper);
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(List.of(syncConfig("main", "g4-main")));
        // 依赖闸门 flow：声明了 wbdata_planned_time input，但没有参数快照
        when(kestraClient.getExecution("exec-main")).thenReturn(execution(
                "exec-main", "g4-main", "daily", "FAILED",
                "2026-06-07T02:00:00Z",
                "2026-06-07T02:00:05Z",
                "2026-06-07T02:00:06Z",
                "2026-06-07T02:10:00Z",
                List.of()));
        when(kestraClient.getFlowSource("g4-main", "daily")).thenReturn("""
                id: daily
                namespace: g4-main
                inputs:
                  - id: wbdata_planned_time
                    type: DATETIME
                    required: false
                  - id: wbdata_bypass_gate
                    type: BOOL
                    defaults: false
                tasks: []
                """);
        when(kestraClient.createExecution(
                Mockito.eq("g4-main"), Mockito.eq("daily"), Mockito.anyMap(), Mockito.anyMap()))
                .thenReturn(execution("rerun-1", "g4-main", "daily", "CREATED", "2026-06-07T03:00:00Z"));
        when(actionMapper.insert(Mockito.any())).thenReturn(1);

        service.rerunExecution(4L, 9L, "exec-main", false);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, String>> inputs = ArgumentCaptor.forClass(Map.class);
        verify(kestraClient).createExecution(
                Mockito.eq("g4-main"), Mockito.eq("daily"), inputs.capture(), Mockito.anyMap());
        assertThat(inputs.getValue()).containsExactly(
                Map.entry(ExecutionTimeContext.PLANNED_TIME_INPUT, "2026-06-07T02:00:00Z"));
    }

    @Test
    void rerunExecution_rejectsGatedFlowRerunWhenOriginalHasNoPlannedTime() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        WbOperationExecutionActionMapper actionMapper = Mockito.mock(WbOperationExecutionActionMapper.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient, actionMapper);
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(List.of(syncConfig("main", "g4-main")));
        // 手动旁路执行：没有 trigger.date，也没有计划时间 input
        when(kestraClient.getExecution("exec-main")).thenReturn(execution(
                "exec-main", "g4-main", "daily", "FAILED",
                null,
                "2026-06-07T02:00:05Z",
                "2026-06-07T02:00:06Z",
                "2026-06-07T02:10:00Z",
                List.of()));
        when(kestraClient.getFlowSource("g4-main", "daily")).thenReturn("""
                id: daily
                namespace: g4-main
                inputs:
                  - id: wbdata_planned_time
                    type: DATETIME
                    required: false
                tasks: []
                """);

        assertThatThrownBy(() -> service.rerunExecution(4L, 9L, "exec-main", false))
                .isInstanceOfSatisfying(ResponseStatusException.class, exception ->
                        assertThat(exception.getReason()).isEqualTo("原执行缺少计划时间，无法重跑"));
        verify(kestraClient, never()).createExecution(
                Mockito.anyString(), Mockito.anyString(), Mockito.anyMap(), Mockito.anyMap());
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
                        "wbdataParameterOverrideKeys", "name"),
                Map.of());
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
                Map.of(ExecutionParameterSnapshotRegistry.LABEL_KEY, "snapshot-old"),
                Map.of());
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

    @Test
    void listExecutions_computesStatusCountsBeforeStatusFilterAndSupportsActiveStatus() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient);
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(List.of(syncConfig("main", "g4-main")));
        stubPagedSearch(kestraClient, List.of(
                execution("e-success", "g4-main", "job_a", "SUCCESS", "2026-06-07T01:05:00Z"),
                execution("e-failed", "g4-main", "job_b", "FAILED", "2026-06-07T01:04:00Z"),
                execution("e-running", "g4-main", "job_c", "RUNNING", "2026-06-07T01:03:00Z"),
                execution("e-queued", "g4-main", "job_d", "QUEUED", "2026-06-07T01:02:00Z"),
                execution("e-created", "g4-main", "job_e", "CREATED", "2026-06-07T01:01:00Z"),
                execution("e-retrying", "g4-main", "job_f", "RETRYING", "2026-06-07T01:00:30Z"),
                execution("e-paused", "g4-main", "job_g", "PAUSED", "2026-06-07T01:00:15Z"),
                execution("e-killed", "g4-main", "job_h", "KILLED", "2026-06-07T01:00:10Z"),
                execution("e-cancelled", "g4-main", "job_i", "CANCELLED", "2026-06-07T01:00:05Z")
        ));

        OperationsExecutionListResponse failedOnly = service.listExecutions(4L, listQuery(
                "main", null, "FAILED", FROM, TO));
        assertThat(failedOnly.executions()).extracting("id").containsExactly("e-failed");
        assertThat(failedOnly.statusCounts()).isEqualTo(new OperationsExecutionStatusCounts(9, 1, 1, 5, 2));

        OperationsExecutionListResponse activeOnly = service.listExecutions(4L, listQuery(
                "main", null, "ACTIVE", FROM, TO));
        assertThat(activeOnly.executions()).extracting("id")
                .containsExactly("e-running", "e-queued", "e-created", "e-retrying", "e-paused");
        assertThat(activeOnly.executions()).allSatisfy(item -> assertThat(item.stoppable()).isTrue());
    }

    @Test
    void stopExecution_killsActiveExecutionAndWritesStopAudit() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        WbOperationExecutionActionMapper actionMapper = Mockito.mock(WbOperationExecutionActionMapper.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient, actionMapper);
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(List.of(syncConfig("main", "g4-main")));
        when(kestraClient.getExecution("exec-run"))
                .thenReturn(execution("exec-run", "g4-main", "daily_job", "RUNNING", "2026-06-07T01:00:00Z"));
        when(actionMapper.insert(Mockito.any())).thenReturn(1);

        service.stopExecution(4L, 9L, "exec-run");

        verify(kestraClient).killExecution("exec-run");
        ArgumentCaptor<WbOperationExecutionAction> actionCaptor = ArgumentCaptor.forClass(WbOperationExecutionAction.class);
        verify(actionMapper).insert(actionCaptor.capture());
        WbOperationExecutionAction recorded = actionCaptor.getValue();
        assertThat(recorded.getGroupId()).isEqualTo(4L);
        assertThat(recorded.getActionType()).isEqualTo("STOP");
        assertThat(recorded.getOriginalExecutionId()).isEqualTo("exec-run");
        assertThat(recorded.getNewExecutionId()).isNull();
        assertThat(recorded.getNamespace()).isEqualTo("g4-main");
        assertThat(recorded.getFlowId()).isEqualTo("daily_job");
        assertThat(recorded.getRequestedBy()).isEqualTo(9L);
    }

    @Test
    void stopExecution_rejectsTerminalStatuses() {
        for (String status : List.of("SUCCESS", "FAILED", "KILLED", "CANCELLED", "RETRIED")) {
            GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
            KestraClient kestraClient = Mockito.mock(KestraClient.class);
            WbOperationExecutionActionMapper actionMapper = Mockito.mock(WbOperationExecutionActionMapper.class);
            OperationsExecutionService service = service(gitSyncConfigService, kestraClient, actionMapper);
            when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(List.of(syncConfig("main", "g4-main")));
            when(kestraClient.getExecution("exec-term"))
                    .thenReturn(execution("exec-term", "g4-main", "daily_job", status, "2026-06-07T01:00:00Z"));

            assertThatThrownBy(() -> service.stopExecution(4L, 9L, "exec-term"))
                    .isInstanceOfSatisfying(ResponseStatusException.class, exception -> {
                        assertThat(exception.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
                        assertThat(exception.getReason()).isEqualTo("当前状态不支持停止");
                    });

            verify(kestraClient, never()).killExecution(Mockito.anyString());
            verify(actionMapper, never()).insert(Mockito.any());
        }
    }

    @Test
    void stopExecution_rejectsExecutionOutsideGroupScope() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        WbOperationExecutionActionMapper actionMapper = Mockito.mock(WbOperationExecutionActionMapper.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient, actionMapper);
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(List.of(syncConfig("main", "g4-main")));
        when(kestraClient.getExecution("exec-other"))
                .thenReturn(execution("exec-other", "g9-main", "other_job", "RUNNING", "2026-06-07T01:00:00Z"));

        assertThatThrownBy(() -> service.stopExecution(4L, 9L, "exec-other"))
                .isInstanceOfSatisfying(ResponseStatusException.class, exception ->
                        assertThat(exception.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND));

        verify(kestraClient, never()).killExecution(Mockito.anyString());
    }

    @Test
    void stopExecution_succeedsWhenAuditInsertFailsAfterKill() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        WbOperationExecutionActionMapper actionMapper = Mockito.mock(WbOperationExecutionActionMapper.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient, actionMapper);
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(List.of(syncConfig("main", "g4-main")));
        when(kestraClient.getExecution("exec-queued"))
                .thenReturn(execution("exec-queued", "g4-main", "daily_job", "QUEUED", "2026-06-07T01:00:00Z"));
        when(actionMapper.insert(Mockito.any())).thenThrow(new IllegalStateException("audit error"));

        service.stopExecution(4L, 9L, "exec-queued");

        verify(kestraClient).killExecution("exec-queued");
    }

    @Test
    void listAndDetail_distinguishManualRerunFromAutoRetry_andKeepRetriedNonRerunnable() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        WbOperationExecutionActionMapper actionMapper = Mockito.mock(WbOperationExecutionActionMapper.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient, actionMapper);
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(List.of(syncConfig("main", "g4-main")));

        KestraExecutionSnapshot firstAttempt = new KestraExecutionSnapshot(
                "exec-1", "g4-main", "daily_job", "RETRIED", null,
                Instant.parse("2026-06-07T01:00:00Z"), Instant.parse("2026-06-07T01:00:01Z"),
                Instant.parse("2026-06-07T01:00:05Z"), List.of(), Map.of(), Map.of(), Map.of(),
                "exec-1", 1);
        KestraExecutionSnapshot autoRetry = new KestraExecutionSnapshot(
                "exec-2", "g4-main", "daily_job", "FAILED", null,
                Instant.parse("2026-06-07T01:05:00Z"), Instant.parse("2026-06-07T01:05:01Z"),
                Instant.parse("2026-06-07T01:05:05Z"), List.of(), Map.of(), Map.of(), Map.of(),
                "exec-1", 2);
        KestraExecutionSnapshot manualRerun = new KestraExecutionSnapshot(
                "exec-3", "g4-main", "daily_job", "RETRIED", null,
                Instant.parse("2026-06-07T01:10:00Z"), Instant.parse("2026-06-07T01:10:01Z"),
                Instant.parse("2026-06-07T01:10:05Z"), List.of(), Map.of(), Map.of(), Map.of(),
                "exec-3", 1);
        KestraExecutionSnapshot autoRetryAfterManual = new KestraExecutionSnapshot(
                "exec-4", "g4-main", "daily_job", "SUCCESS", null,
                Instant.parse("2026-06-07T01:15:00Z"), Instant.parse("2026-06-07T01:15:01Z"),
                Instant.parse("2026-06-07T01:15:05Z"), List.of(), Map.of(), Map.of(), Map.of(),
                "exec-3", 2);

        stubPagedSearch(kestraClient, List.of(firstAttempt, autoRetry, manualRerun, autoRetryAfterManual));
        when(kestraClient.getExecution("exec-2")).thenReturn(autoRetry);
        when(kestraClient.getExecution("exec-3")).thenReturn(manualRerun);
        when(kestraClient.getFlowSource("g4-main", "daily_job")).thenReturn("id: daily_job\nnamespace: g4-main\ntasks: []");

        WbOperationExecutionAction manualAction = new WbOperationExecutionAction();
        manualAction.setActionType("RERUN");
        manualAction.setNewExecutionId("exec-3");
        when(actionMapper.selectList(Mockito.any())).thenReturn(List.of(manualAction));

        OperationsExecutionListResponse response = service.listExecutions(
                4L, listQuery("main", null, null, FROM, TO));

        assertThat(response.executions()).extracting("id")
                .containsExactly("exec-4", "exec-3", "exec-2", "exec-1");
        assertThat(response.statusCounts()).isEqualTo(new OperationsExecutionStatusCounts(4, 1, 1, 0, 0));

        OperationsExecutionListItem item4 = response.executions().get(0);
        assertThat(item4.rerun()).isTrue();
        assertThat(item4.rerunType()).isEqualTo("AUTO");
        assertThat(item4.retryAttempt()).isEqualTo(1);

        OperationsExecutionListItem item3 = response.executions().get(1);
        assertThat(item3.rerun()).isTrue();
        assertThat(item3.rerunType()).isEqualTo("MANUAL");
        assertThat(item3.retryAttempt()).isNull();
        assertThat(item3.rerunnable()).isFalse();
        assertThat(item3.stoppable()).isFalse();

        OperationsExecutionListItem item2 = response.executions().get(2);
        assertThat(item2.rerun()).isTrue();
        assertThat(item2.rerunType()).isEqualTo("AUTO");
        assertThat(item2.retryAttempt()).isEqualTo(1);

        OperationsExecutionListItem item1 = response.executions().get(3);
        assertThat(item1.rerun()).isFalse();
        assertThat(item1.rerunType()).isEqualTo("NONE");
        assertThat(item1.retryAttempt()).isNull();
        assertThat(item1.rerunnable()).isFalse();

        OperationsExecutionDetailResponse autoDetail = service.getExecution(4L, "exec-2");
        assertThat(autoDetail.rerun()).isTrue();
        assertThat(autoDetail.rerunType()).isEqualTo("AUTO");
        assertThat(autoDetail.retryAttempt()).isEqualTo(1);

        OperationsExecutionDetailResponse manualDetail = service.getExecution(4L, "exec-3");
        assertThat(manualDetail.rerun()).isTrue();
        assertThat(manualDetail.rerunType()).isEqualTo("MANUAL");
        assertThat(manualDetail.retryAttempt()).isNull();
        assertThat(manualDetail.rerunnable()).isFalse();
    }

    @Test
    void partialRerun_buildsContextValidatesAndSubmitsPartialLabelsAndInputs() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        WbOperationExecutionActionMapper actionMapper = Mockito.mock(WbOperationExecutionActionMapper.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient, actionMapper);
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(List.of(syncConfig("main", "g4-main")));

        String flowSource = """
                id: daily_job
                namespace: g4-main
                inputs:
                  - id: wbdata_planned_time
                    type: DATETIME
                    required: false
                  - id: wbdata_rerun_tasks
                    type: STRING
                    required: false
                tasks:
                  - id: flow_dag
                    type: io.kestra.plugin.core.flow.Dag
                    tasks:
                      - task:
                          id: extract
                          type: io.kestra.plugin.scripts.shell.Commands
                          runIf: "{{ (inputs.wbdata_rerun_tasks ?? '') == '' or ((',' ~ (inputs.wbdata_rerun_tasks ?? '') ~ ',') contains ',extract,') }}"
                          commands: ["echo 1"]
                      - dependsOn: ["extract"]
                        task:
                          id: transform
                          type: io.kestra.plugin.scripts.shell.Commands
                          runIf: "{{ (inputs.wbdata_rerun_tasks ?? '') == '' or ((',' ~ (inputs.wbdata_rerun_tasks ?? '') ~ ',') contains ',transform,') }}"
                          commands: ["echo 2"]
                      - dependsOn: ["transform"]
                        task:
                          id: load
                          type: io.kestra.plugin.scripts.shell.Commands
                          runIf: "{{ (inputs.wbdata_rerun_tasks ?? '') == '' or ((',' ~ (inputs.wbdata_rerun_tasks ?? '') ~ ',') contains ',load,') }}"
                          commands: ["echo 3"]
                """;
        KestraExecutionSnapshot original = execution(
                "exec-1", "g4-main", "daily_job", "FAILED",
                "2026-06-07T00:00:00Z", "2026-06-07T01:00:00Z",
                "2026-06-07T01:00:01Z", "2026-06-07T01:02:00Z",
                List.of(
                        taskRun("flow_dag", "FAILED"),
                        taskRun("extract", "SUCCESS"),
                        taskRun("transform", "FAILED")
                )
        );
        when(kestraClient.getExecution("exec-1")).thenReturn(original);
        when(kestraClient.getFlowSource("g4-main", "daily_job")).thenReturn(flowSource);

        OperationsExecutionRerunContextResponse context = service.getRerunContext(4L, "exec-1");
        assertThat(context.partialRerunSupported()).isTrue();
        assertThat(context.defaultSelectedTaskIds()).containsExactly("transform", "load");
        assertThat(context.requiredTaskIds()).containsExactly("transform", "load");
        assertThat(context.nodes()).extracting("executionStatus")
                .containsExactly("SUCCESS", "FAILED", "NOT_RUN");

        // Invalid partial request with missing required node should fail before creating execution
        assertThatThrownBy(() -> service.rerunExecution(4L, 9L, "exec-1", false, List.of("extract", "transform")))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getReason()).contains("load"));
        verify(kestraClient, never()).createExecution(
                Mockito.anyString(), Mockito.anyString(), Mockito.anyMap(), Mockito.anyMap());

        when(kestraClient.createExecution(
                Mockito.eq("g4-main"), Mockito.eq("daily_job"), Mockito.anyMap(), Mockito.anyMap()))
                .thenReturn(execution("rerun-partial", "g4-main", "daily_job", "CREATED", "2026-06-07T01:10:00Z"));
        when(actionMapper.insert(Mockito.any())).thenReturn(1);

        service.rerunExecution(4L, 9L, "exec-1", false, List.of("load", "transform"));

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, String>> inputsCaptor = ArgumentCaptor.forClass(Map.class);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, String>> labelsCaptor = ArgumentCaptor.forClass(Map.class);
        verify(kestraClient).createExecution(
                Mockito.eq("g4-main"), Mockito.eq("daily_job"), inputsCaptor.capture(), labelsCaptor.capture());
        assertThat(inputsCaptor.getValue())
                .containsEntry("wbdata_planned_time", "2026-06-07T00:00:00Z")
                .containsEntry("wbdata_rerun_tasks", "transform,load");
        assertThat(labelsCaptor.getValue())
                .containsEntry("wbdataParameterOverrideKeys", "__none__")
                .containsEntry("wbdataRerunSelectedCount", "2")
                .containsEntry("wbdataRerunTotalCount", "3");

        // Full selection normalizes back to full rerun (omits wbdata_rerun_tasks & partial labels)
        service.rerunExecution(4L, 9L, "exec-1", false, List.of("extract", "transform", "load"));
        verify(kestraClient, Mockito.times(2)).createExecution(
                Mockito.eq("g4-main"), Mockito.eq("daily_job"), inputsCaptor.capture(), labelsCaptor.capture());
        assertThat(inputsCaptor.getValue()).doesNotContainKey("wbdata_rerun_tasks");
        assertThat(labelsCaptor.getValue())
                .doesNotContainKey("wbdataRerunSelectedCount")
                .doesNotContainKey("wbdataRerunTotalCount");

        // Created partial rerun detail & list expose partial counts and keep parameterResolutionStatus NONE
        KestraExecutionSnapshot createdPartial = new KestraExecutionSnapshot(
                "rerun-partial", "g4-main", "daily_job", "SUCCESS",
                Instant.parse("2026-06-07T00:00:00Z"),
                Instant.parse("2026-06-07T01:10:00Z"),
                Instant.parse("2026-06-07T01:10:01Z"),
                Instant.parse("2026-06-07T01:10:30Z"),
                List.of(taskRun("extract", "SKIPPED"), taskRun("transform", "SUCCESS"), taskRun("load", "SUCCESS")),
                Map.of("wbdata_planned_time", "2026-06-07T00:00:00Z", "wbdata_rerun_tasks", "transform,load"),
                Map.of("wbdataRerunSelectedCount", "2", "wbdataRerunTotalCount", "3"),
                Map.of()
        );
        WbOperationExecutionAction partialAction = new WbOperationExecutionAction();
        partialAction.setActionType("RERUN");
        partialAction.setNewExecutionId("rerun-partial");
        when(actionMapper.selectList(Mockito.any())).thenReturn(List.of(partialAction));
        when(kestraClient.getExecution("rerun-partial")).thenReturn(createdPartial);
        stubPagedSearch(kestraClient, List.of(createdPartial));

        OperationsExecutionDetailResponse detail = service.getExecution(4L, "rerun-partial");
        assertThat(detail.parameterResolutionStatus()).isEqualTo("NONE");
        assertThat(detail.partialRerun()).isTrue();
        assertThat(detail.rerunSelectedTaskCount()).isEqualTo(2);
        assertThat(detail.rerunTotalTaskCount()).isEqualTo(3);

        OperationsExecutionListResponse list = service.listExecutions(4L, listQuery("main", null, null, FROM, TO));
        assertThat(list.executions().getFirst().partialRerun()).isTrue();
        assertThat(list.executions().getFirst().rerunSelectedTaskCount()).isEqualTo(2);
        assertThat(list.executions().getFirst().rerunTotalTaskCount()).isEqualTo(3);
    }

    @Test
    void markExecutionSuccess_labelsBeforeStatusChangeWritesAuditAndRejectsNonMarkableStates() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        WbOperationExecutionActionMapper actionMapper = Mockito.mock(WbOperationExecutionActionMapper.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient, actionMapper);
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(List.of(syncConfig("main", "g4-main")));

        KestraExecutionSnapshot failed = new KestraExecutionSnapshot(
                "exec-fail", "g4-main", "daily_job", "FAILED",
                Instant.parse("2026-06-07T00:00:00Z"),
                Instant.parse("2026-06-07T01:00:00Z"),
                Instant.parse("2026-06-07T01:00:01Z"),
                Instant.parse("2026-06-07T01:00:10Z"),
                List.of(taskRun("step_a", "SUCCESS"), taskRun("step_b", "FAILED")),
                Map.of(),
                Map.of("wbdataParameterOverrideKeys", "__none__", "system.correlationId", "exec-fail"),
                Map.of()
        );
        when(kestraClient.getExecution("exec-fail")).thenReturn(failed);
        when(actionMapper.insert(Mockito.any())).thenReturn(1);

        service.markExecutionSuccess(4L, 9L, "系统管理员", "exec-fail");

        var inOrder = Mockito.inOrder(kestraClient);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, String>> labelsCaptor = ArgumentCaptor.forClass(Map.class);
        inOrder.verify(kestraClient).setExecutionLabels(Mockito.eq("exec-fail"), labelsCaptor.capture());
        inOrder.verify(kestraClient).changeExecutionStatus("exec-fail", "SUCCESS");

        assertThat(labelsCaptor.getValue())
                .containsEntry("wbdataParameterOverrideKeys", "__none__")
                .containsEntry(OperationsForceSuccess.LABEL_FORCE_SUCCESS, "true")
                .containsEntry(OperationsForceSuccess.LABEL_FORCE_SUCCESS_BY, "系统管理员")
                .doesNotContainKey("system.correlationId")
                .containsKey(OperationsForceSuccess.LABEL_FORCE_SUCCESS_AT);
        assertThat(Long.parseLong(labelsCaptor.getValue().get(OperationsForceSuccess.LABEL_FORCE_SUCCESS_AT)))
                .isPositive();

        ArgumentCaptor<WbOperationExecutionAction> actionCaptor = ArgumentCaptor.forClass(WbOperationExecutionAction.class);
        verify(actionMapper).insert(actionCaptor.capture());
        assertThat(actionCaptor.getValue().getActionType()).isEqualTo("MARK_SUCCESS");
        assertThat(actionCaptor.getValue().getOriginalExecutionId()).isEqualTo("exec-fail");
        assertThat(actionCaptor.getValue().getNewExecutionId()).isNull();
        assertThat(actionCaptor.getValue().getRequestedBy()).isEqualTo(9L);

        // KILLED and CANCELLED are also markable
        when(kestraClient.getExecution("exec-killed"))
                .thenReturn(execution("exec-killed", "g4-main", "daily_job", "KILLED", "2026-06-07T01:00:00Z"));
        when(kestraClient.getExecution("exec-cancelled"))
                .thenReturn(execution("exec-cancelled", "g4-main", "daily_job", "CANCELLED", "2026-06-07T01:00:00Z"));
        service.markExecutionSuccess(4L, 9L, "admin", "exec-killed");
        service.markExecutionSuccess(4L, 9L, "admin", "exec-cancelled");

        // SUCCESS, FORCE_SUCCESS, RUNNING, RETRIED are rejected
        for (String disallowed : List.of("SUCCESS", "RUNNING", "RETRIED")) {
            when(kestraClient.getExecution("exec-" + disallowed))
                    .thenReturn(execution("exec-" + disallowed, "g4-main", "daily_job", disallowed, "2026-06-07T01:00:00Z"));
            assertThatThrownBy(() -> service.markExecutionSuccess(4L, 9L, "admin", "exec-" + disallowed))
                    .isInstanceOfSatisfying(ResponseStatusException.class,
                            ex -> assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST));
        }
        KestraExecutionSnapshot alreadyForced = new KestraExecutionSnapshot(
                "exec-forced", "g4-main", "daily_job", "SUCCESS",
                Instant.parse("2026-06-07T00:00:00Z"),
                Instant.parse("2026-06-07T01:00:00Z"),
                Instant.parse("2026-06-07T01:00:01Z"),
                Instant.parse("2026-06-07T01:00:10Z"),
                List.of(taskRun("step_b", "FAILED")),
                Map.of(),
                Map.of(OperationsForceSuccess.LABEL_FORCE_SUCCESS, "true"),
                Map.of()
        );
        when(kestraClient.getExecution("exec-forced")).thenReturn(alreadyForced);
        assertThatThrownBy(() -> service.markExecutionSuccess(4L, 9L, "admin", "exec-forced"))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST));
    }

    @Test
    void forceSuccess_translatesListFilterCountsDetailAndDisallowsRerunWhileKeepingFailedTaskRuns() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient);
        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(List.of(syncConfig("main", "g4-main")));

        Instant forcedAt = Instant.parse("2026-06-07T01:15:00Z");
        KestraExecutionSnapshot forcedExec = new KestraExecutionSnapshot(
                "exec-forced", "g4-main", "daily_job", "SUCCESS",
                Instant.parse("2026-06-07T00:00:00Z"),
                Instant.parse("2026-06-07T01:00:00Z"),
                Instant.parse("2026-06-07T01:00:01Z"),
                Instant.parse("2026-06-07T01:00:10Z"),
                List.of(
                        taskRun("step_a", "SUCCESS", "2026-06-07T01:00:01Z", "2026-06-07T01:00:05Z"),
                        taskRun("step_b", "FAILED", "2026-06-07T01:00:05Z", "2026-06-07T01:00:10Z")
                ),
                Map.of(),
                Map.of(
                        OperationsForceSuccess.LABEL_FORCE_SUCCESS, "true",
                        OperationsForceSuccess.LABEL_FORCE_SUCCESS_BY, "系统管理员",
                        OperationsForceSuccess.LABEL_FORCE_SUCCESS_AT, String.valueOf(forcedAt.toEpochMilli())
                ),
                Map.of()
        );
        KestraExecutionSnapshot organicSuccess = execution("exec-ok", "g4-main", "daily_job", "SUCCESS", "2026-06-07T01:05:00Z");
        KestraExecutionSnapshot failedExec = execution("exec-fail", "g4-main", "daily_job", "FAILED", "2026-06-07T01:10:00Z");

        stubPagedSearch(kestraClient, List.of(forcedExec, organicSuccess, failedExec));
        when(kestraClient.getExecution("exec-forced")).thenReturn(forcedExec);

        OperationsExecutionListResponse allList = service.listExecutions(4L, listQuery("main", null, null, FROM, TO));
        assertThat(allList.statusCounts()).isEqualTo(new OperationsExecutionStatusCounts(3, 2, 1, 0, 0));
        assertThat(allList.executions()).extracting("id", "status", "rerunnable", "markableSuccess")
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple("exec-fail", "FAILED", true, true),
                        org.assertj.core.groups.Tuple.tuple("exec-ok", "SUCCESS", false, false),
                        org.assertj.core.groups.Tuple.tuple("exec-forced", "FORCE_SUCCESS", false, false)
                );

        OperationsExecutionListResponse forceOnly = service.listExecutions(4L, listQuery("main", null, "FORCE_SUCCESS", FROM, TO));
        assertThat(forceOnly.executions()).extracting("id").containsExactly("exec-forced");

        OperationsExecutionListResponse successGroup = service.listExecutions(4L, listQuery("main", null, "SUCCESS", FROM, TO));
        assertThat(successGroup.executions()).extracting("id").containsExactly("exec-ok", "exec-forced");

        OperationsExecutionDetailResponse detail = service.getExecution(4L, "exec-forced");
        assertThat(detail.status()).isEqualTo("FORCE_SUCCESS");
        assertThat(detail.rerunnable()).isFalse();
        assertThat(detail.markableSuccess()).isFalse();
        assertThat(detail.forceSuccess()).isTrue();
        assertThat(detail.forceSuccessBy()).isEqualTo("系统管理员");
        assertThat(detail.forceSuccessAt()).isEqualTo(forcedAt);
        assertThat(detail.taskRuns()).extracting("taskId", "status")
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple("step_a", "SUCCESS"),
                        org.assertj.core.groups.Tuple.tuple("step_b", "FAILED")
                );

        assertThatThrownBy(() -> service.rerunExecution(4L, 9L, "exec-forced", false))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST));
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
                null,
                null,
                null,
                null
        );
    }

    private static void stubPagedSearch(KestraClient kestraClient, List<KestraExecutionSnapshot> snapshots) {
        when(kestraClient.searchExecutionsPage(Mockito.anyMap(), Mockito.anyInt(), Mockito.anyInt(), Mockito.any()))
                .thenAnswer(invocation -> {
                    @SuppressWarnings("unchecked")
                    Map<String, String> filters = invocation.getArgument(0);
                    int page = invocation.getArgument(1);
                    int size = invocation.getArgument(2);
                    String sort = invocation.getArgument(3);
                    java.util.Set<String> allowedNamespaces = new java.util.HashSet<>();
                    if (filters.containsKey("filters[namespace][EQUALS]")) {
                        allowedNamespaces.add(filters.get("filters[namespace][EQUALS]"));
                    } else if (filters.containsKey("filters[namespace][IN]")) {
                        allowedNamespaces.addAll(List.of(filters.get("filters[namespace][IN]").split(",")));
                    }
                    Instant start = filters.containsKey("startDate") ? Instant.parse(filters.get("startDate")) : Instant.MIN;
                    Instant end = filters.containsKey("endDate") ? Instant.parse(filters.get("endDate")) : Instant.MAX;
                    String flowRegex = filters.get("filters[flowId][REGEX]");
                    java.util.regex.Pattern flowPattern = flowRegex == null
                            ? null
                            : java.util.regex.Pattern.compile(flowRegex);
                    java.util.Set<String> allowedFlowIds = null;
                    if (filters.containsKey("filters[flowId][EQUALS]")) {
                        allowedFlowIds = java.util.Set.of(filters.get("filters[flowId][EQUALS]"));
                    } else if (filters.containsKey("filters[flowId][IN]")) {
                        allowedFlowIds = new java.util.HashSet<>(List.of(filters.get("filters[flowId][IN]").split(",")));
                    }
                    java.util.Set<String> allowedStates = null;
                    if (filters.containsKey("filters[state][EQUALS]")) {
                        allowedStates = java.util.Set.of(filters.get("filters[state][EQUALS]"));
                    } else if (filters.containsKey("filters[state][IN]")) {
                        allowedStates = new java.util.HashSet<>(List.of(filters.get("filters[state][IN]").split(",")));
                    }
                    String expectedForceSuccess = filters.get("filters[labels][EQUALS][wbdataForceSuccess]");

                    java.util.Comparator<KestraExecutionSnapshot> order = "state.startDate:desc".equals(sort)
                            ? (left, right) -> {
                                Instant lt = left.createdAt() == null ? left.startDate() : left.createdAt();
                                Instant rt = right.createdAt() == null ? right.startDate() : right.createdAt();
                                if (lt == null && rt == null) return 0;
                                if (lt == null) return 1;
                                if (rt == null) return -1;
                                return rt.compareTo(lt);
                            }
                            : (left, right) -> 0;

                    java.util.Set<String> finalAllowedFlowIds = allowedFlowIds;
                    java.util.Set<String> finalAllowedStates = allowedStates;
                    List<KestraExecutionSnapshot> matched = snapshots.stream()
                            .filter(item -> item.namespace() != null && allowedNamespaces.contains(item.namespace()))
                            .filter(item -> {
                                Instant t = item.createdAt() == null ? item.startDate() : item.createdAt();
                                return t != null && !t.isBefore(start) && !t.isAfter(end);
                            })
                            .filter(item -> flowPattern == null
                                    || (item.flowId() != null && flowPattern.matcher(item.flowId()).matches()))
                            .filter(item -> finalAllowedFlowIds == null
                                    || (item.flowId() != null && finalAllowedFlowIds.contains(item.flowId())))
                            .filter(item -> finalAllowedStates == null || finalAllowedStates.contains(item.status()))
                            .filter(item -> expectedForceSuccess == null
                                    || expectedForceSuccess.equals(item.labels() == null
                                    ? null : item.labels().get("wbdataForceSuccess")))
                            .sorted(order)
                            .toList();
                    List<KestraExecutionSnapshot> sliced = matched.stream()
                            .skip((long) (page - 1) * size)
                            .limit(size)
                            .toList();
                    long reportedTotal = (page > 1 && sliced.isEmpty()) ? 0L : matched.size();
                    return new KestraExecutionPage(sliced, reportedTotal);
                });
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

    private static Map<String, String> searchFilterIn(String namespacesCsv, String from, String to) {
        Map<String, String> filters = new LinkedHashMap<>();
        filters.put("filters[namespace][IN]", namespacesCsv);
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

    @Test
    void listExecutions_enrichesAndFiltersByFlowOwner() {
        GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        KestraClient kestraClient = Mockito.mock(KestraClient.class);
        OfflineFlowIndexService indexService = Mockito.mock(OfflineFlowIndexService.class);
        GroupOwnerService ownerService = Mockito.mock(GroupOwnerService.class);
        OperationsExecutionService service = service(gitSyncConfigService, kestraClient);
        service.setOfflineFlowIndexService(indexService);
        service.setGroupOwnerService(ownerService);

        when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(syncConfigs());
        when(indexService.isEnabled()).thenReturn(true);

        WbOfflineFlowIndex flowAlice = new WbOfflineFlowIndex();
        flowAlice.setFlowPath("_flows/daily_policy/flow.yaml");
        flowAlice.setFlowId("daily_policy");
        flowAlice.setOwnerUserId(10L);

        WbOfflineFlowIndex flowBob = new WbOfflineFlowIndex();
        flowBob.setFlowPath("_flows/weekly_etl/flow.yaml");
        flowBob.setFlowId("weekly_etl");
        flowBob.setOwnerUserId(20L);

        when(indexService.findFlowOwnersByGroupAndBranches(Mockito.eq(4L), Mockito.anyMap())).thenReturn(Map.of(
                "main::daily_policy", 10L,
                "main::weekly_etl", 20L
        ));
        when(indexService.listFlowsByGroupAndBranchAndOwner(4L, "main", 10L)).thenReturn(List.of(flowAlice));
        when(indexService.listFlowsByGroupAndBranchAndOwner(4L, "main", 99L)).thenReturn(List.of());
        when(ownerService.resolveOwners(Mockito.eq(4L), Mockito.anyCollection())).thenReturn(Map.of(
                10L, new GroupOwnerInfo(10L, "alice", "Alice", "ACTIVE"),
                20L, new GroupOwnerInfo(20L, "bob", "Bob", "LEFT_GROUP")
        ));

        stubPagedSearch(kestraClient, List.of(
                execution("e1", "g4-main", "daily_policy", "SUCCESS", "2026-06-07T02:00:00Z"),
                execution("e2", "g4-main", "weekly_etl", "FAILED", "2026-06-07T01:00:00Z")
        ));

        OperationsExecutionListResponse allRes = service.listExecutions(
                4L, listQuery("main", null, null, FROM, TO));
        assertThat(allRes.executions()).hasSize(2);
        assertThat(allRes.executions().get(0).ownerName()).isEqualTo("Alice");
        assertThat(allRes.executions().get(1).ownerStatus()).isEqualTo("LEFT_GROUP");

        OperationsExecutionListResponse aliceRes = service.listExecutions(
                4L, new OperationsExecutionQuery("main", null, null, FROM, TO, null, null, 10L));
        assertThat(aliceRes.executions()).extracting(OperationsExecutionListItem::flowId)
                .containsExactly("daily_policy");

        OperationsExecutionListResponse emptyRes = service.listExecutions(
                4L, new OperationsExecutionQuery("main", null, null, FROM, TO, null, null, 99L));
        assertThat(emptyRes.executions()).isEmpty();
        assertThat(emptyRes.total()).isZero();
    }
}
