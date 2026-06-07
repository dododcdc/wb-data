package com.wbdata.operations.service;

import com.wbdata.git.dto.GitSyncConfigResponse;
import com.wbdata.git.service.GitSyncConfigService;
import com.wbdata.offline.service.KestraClient;
import com.wbdata.offline.service.KestraExecutionSnapshot;
import com.wbdata.offline.service.KestraTaskRunSnapshot;
import com.wbdata.operations.dto.OperationsExecutionListResponse;
import com.wbdata.operations.dto.OperationsExecutionQuery;
import com.wbdata.operations.mapper.WbOperationExecutionActionMapper;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.time.Instant;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class OperationsExecutionServiceTest {
    private static final Instant FROM = Instant.parse("2026-06-06T00:00:00Z");
    private static final Instant TO = Instant.parse("2026-06-08T00:00:00Z");

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
        assertThat(response.executions().getFirst().failureSummary()).isEqualTo("load_policy failed");
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

    private static OperationsExecutionService service(GitSyncConfigService gitSyncConfigService,
                                                      KestraClient kestraClient) {
        return new OperationsExecutionService(
                gitSyncConfigService,
                kestraClient,
                Mockito.mock(WbOperationExecutionActionMapper.class)
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
        Map<String, String> filters = new LinkedHashMap<>();
        filters.put("filters[namespace][EQUALS]", namespace);
        filters.put("startDate", FROM.toString());
        filters.put("endDate", TO.toString());
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
}
