package com.wbdata.operations.service;

import com.wbdata.auth.dto.ProjectGroupContextItem;
import com.wbdata.auth.enums.Permission;
import com.wbdata.auth.service.PermissionService;
import com.wbdata.git.dto.GitSyncConfigResponse;
import com.wbdata.git.service.GitSyncConfigService;
import com.wbdata.offline.kestra.KestraClient;
import com.wbdata.offline.kestra.KestraExecutionSnapshot;
import com.wbdata.offline.kestra.KestraTaskRunSnapshot;
import com.wbdata.offline.service.ExecutionTimeContext;
import com.wbdata.operations.dto.OperationsInstanceDiagnosisResponse;
import com.wbdata.operations.entity.WbOperationExecutionAction;
import com.wbdata.operations.mapper.WbOperationExecutionActionMapper;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.when;

class OperationsInstanceDiagnosisServiceTest {

    private static final Instant NOW = Instant.parse("2026-10-06T10:00:00Z");

    @Test
    void noSchedule_returnsNoScheduleState() {
        Fixture fixture = new Fixture();
        fixture.stubOwnFlow("""
                id: task_a
                namespace: g4-main
                tasks: []
                """);

        OperationsInstanceDiagnosisResponse response = fixture.service.diagnose(
                4L, "main", "task_a", null, fixture.accessibleGroups());

        assertThat(response.state()).isEqualTo(OperationsInstanceDiagnosisService.STATE_NO_SCHEDULE);
        assertThat(response.reason()).contains("未配置调度");
        assertThat(response.executions()).isEmpty();
        assertThat(response.upstreams()).isEmpty();
    }

    @Test
    void customPeriod_rejected() {
        Fixture fixture = new Fixture();
        fixture.stubOwnFlow("""
                id: task_a
                namespace: g4-main
                labels:
                  wbdataSchedulePeriod: CUSTOM
                triggers:
                  - id: schedule
                    type: io.kestra.plugin.core.trigger.Schedule
                    cron: "*/5 * * * *"
                tasks: []
                """);

        assertThatThrownBy(() -> fixture.service.diagnose(4L, "main", "task_a", null, fixture.accessibleGroups()))
                .isInstanceOfSatisfying(ResponseStatusException.class, exception ->
                        assertThat(exception.getReason()).contains("自定义 Cron"));
    }

    @Test
    void notDue_whenPlannedFireInFuture() {
        Fixture fixture = new Fixture();
        fixture.stubOwnFlow(dailyFlowYaml(null, null, false));

        OperationsInstanceDiagnosisResponse response = fixture.service.diagnose(
                4L, "main", "task_a", "2026-10-07", fixture.accessibleGroups());

        assertThat(response.state()).isEqualTo(OperationsInstanceDiagnosisService.STATE_NOT_DUE);
        assertThat(response.scheduleKey()).isEqualTo("2026-10-07");
        assertThat(response.plannedFireAt()).isEqualTo(Instant.parse("2026-10-07T02:00:00Z"));
        assertThat(response.prevScheduleKey()).isEqualTo("2026-10-06");
        assertThat(response.nextScheduleKey()).isEqualTo("2026-10-08");
        assertThat(response.executions()).isEmpty();
    }

    @Test
    void pendingFire_withinGraceWindow() {
        Fixture fixture = new Fixture(Instant.parse("2026-10-06T02:05:00Z"));
        fixture.stubOwnFlow(dailyFlowYaml(null, null, false));

        OperationsInstanceDiagnosisResponse response = fixture.service.diagnose(
                4L, "main", "task_a", "2026-10-06", fixture.accessibleGroups());

        assertThat(response.state()).isEqualTo(OperationsInstanceDiagnosisService.STATE_PENDING_FIRE);
    }

    @Test
    void missed_afterGraceWindowWithoutExecution() {
        Fixture fixture = new Fixture(Instant.parse("2026-10-06T02:11:00Z"));
        fixture.stubOwnFlow(dailyFlowYaml(null, null, false));

        OperationsInstanceDiagnosisResponse response = fixture.service.diagnose(
                4L, "main", "task_a", "2026-10-06", fixture.accessibleGroups());

        assertThat(response.state()).isEqualTo(OperationsInstanceDiagnosisService.STATE_MISSED);
        assertThat(response.reason()).contains("疑似漏触发");
    }

    @Test
    void scheduleDisabled_whenTriggerDisabledAndNoExecution() {
        Fixture fixture = new Fixture();
        fixture.stubOwnFlow(dailyFlowYaml(null, null, true));

        OperationsInstanceDiagnosisResponse response = fixture.service.diagnose(
                4L, "main", "task_a", "2026-10-06", fixture.accessibleGroups());

        assertThat(response.state()).isEqualTo(OperationsInstanceDiagnosisService.STATE_SCHEDULE_DISABLED);
        assertThat(response.scheduleEnabled()).isFalse();
    }

    @Test
    void waitingUpstream_whenGateActiveAndUpstreamNotSatisfied() {
        Fixture fixture = new Fixture();
        fixture.stubOwnFlow(dailyFlowYaml("2:task_b", null, false));
        fixture.stubExecutions("g4-main", "task_a", List.of(
                execution("exec-a", "g4-main", "task_a", "RUNNING", "2026-10-06T02:00:00Z",
                        "2026-10-06T02:00:05Z", List.of(taskRun("wb_upstream_gate", "RUNNING")), Map.of())));
        fixture.stubUpstreamFlow("g2-main", "task_b");
        fixture.stubExecutions("g2-main", "task_b", List.of());

        OperationsInstanceDiagnosisResponse response = fixture.service.diagnose(
                4L, "main", "task_a", "2026-10-06", fixture.accessibleGroups());

        assertThat(response.state()).isEqualTo(OperationsInstanceDiagnosisService.STATE_WAITING_UPSTREAM);
        assertThat(response.reason()).contains("task_b");
        assertThat(response.upstreams()).hasSize(1);
        assertThat(response.upstreams().getFirst().state())
                .isEqualTo(OperationsInstanceDiagnosisService.STATE_NOT_FIRED);
        assertThat(response.upstreams().getFirst().satisfied()).isFalse();
        assertThat(response.upstreams().getFirst().accessible()).isTrue();
        assertThat(response.upstreams().getFirst().groupName()).isEqualTo("组二");
    }

    @Test
    void runningPassthrough_whenGateAlreadyPassed() {
        Fixture fixture = new Fixture();
        fixture.stubOwnFlow(dailyFlowYaml("2:task_b", null, false));
        fixture.stubExecutions("g4-main", "task_a", List.of(
                execution("exec-a", "g4-main", "task_a", "RUNNING", "2026-10-06T02:00:00Z",
                        "2026-10-06T02:00:05Z", List.of(
                                taskRun("wb_upstream_gate", "SUCCESS"),
                                taskRun("load", "RUNNING")), Map.of())));
        fixture.stubUpstreamFlow("g2-main", "task_b");
        fixture.stubExecutions("g2-main", "task_b", List.of(
                execution("exec-b", "g2-main", "task_b", "SUCCESS", "2026-10-06T01:00:00Z",
                        "2026-10-06T01:00:05Z", List.of(), Map.of())));

        OperationsInstanceDiagnosisResponse response = fixture.service.diagnose(
                4L, "main", "task_a", "2026-10-06", fixture.accessibleGroups());

        assertThat(response.state()).isEqualTo("RUNNING");
        assertThat(response.upstreams().getFirst().satisfied()).isTrue();
        assertThat(response.upstreams().getFirst().executionId()).isEqualTo("exec-b");
    }

    @Test
    void gateTimeout_whenGateFailedWithoutPausePolicy() {
        Fixture fixture = new Fixture(Instant.parse("2026-10-07T03:00:00Z"));
        fixture.stubOwnFlow(dailyFlowYaml("2:task_b", null, false));
        fixture.stubExecutions("g4-main", "task_a", List.of(
                execution("exec-a", "g4-main", "task_a", "FAILED", "2026-10-06T02:00:00Z",
                        "2026-10-06T02:00:05Z", List.of(taskRun("wb_upstream_gate", "FAILED")), Map.of())));
        fixture.stubUpstreamFlow("g2-main", "task_b");
        fixture.stubExecutions("g2-main", "task_b", List.of());

        OperationsInstanceDiagnosisResponse response = fixture.service.diagnose(
                4L, "main", "task_a", "2026-10-06", fixture.accessibleGroups());

        assertThat(response.state()).isEqualTo(OperationsInstanceDiagnosisService.STATE_GATE_TIMEOUT);
        assertThat(response.reason()).contains("超过一个调度周期");
    }

    @Test
    void pausedByPolicy_whenPreviousPeriodAllTerminalWithoutSuccess() {
        Fixture fixture = new Fixture(Instant.parse("2026-10-07T03:00:00Z"));
        fixture.stubOwnFlow(dailyFlowYaml(null, "PAUSE", false));
        fixture.stubExecutions("g4-main", "task_a", List.of(
                execution("exec-a-cur", "g4-main", "task_a", "FAILED", "2026-10-06T02:00:00Z",
                        "2026-10-06T02:00:05Z", List.of(taskRun("wb_upstream_gate", "FAILED")), Map.of()),
                execution("exec-a-prev", "g4-main", "task_a", "FAILED", "2026-10-05T02:00:00Z",
                        "2026-10-05T02:00:05Z", List.of(), Map.of())));

        OperationsInstanceDiagnosisResponse response = fixture.service.diagnose(
                4L, "main", "task_a", "2026-10-06", fixture.accessibleGroups());

        assertThat(response.state()).isEqualTo(OperationsInstanceDiagnosisService.STATE_PAUSED_BY_POLICY);
        assertThat(response.reason()).contains("2026-10-05").contains("PAUSE");
    }

    @Test
    void executionsMarkedRerun_andSortedByCreatedAtDesc() {
        Fixture fixture = new Fixture();
        fixture.stubOwnFlow(dailyFlowYaml(null, null, false));
        fixture.stubExecutions("g4-main", "task_a", List.of(
                execution("exec-original", "g4-main", "task_a", "FAILED", "2026-10-06T02:00:00Z",
                        "2026-10-06T02:00:05Z", List.of(), Map.of()),
                execution("exec-rerun", "g4-main", "task_a", "SUCCESS", null,
                        "2026-10-06T05:00:00Z", List.of(),
                        Map.of(ExecutionTimeContext.PLANNED_TIME_INPUT, "2026-10-06T02:00:00Z"))));
        WbOperationExecutionAction action = new WbOperationExecutionAction();
        action.setActionType("RERUN");
        action.setNewExecutionId("exec-rerun");
        when(fixture.actionMapper.selectList(Mockito.any())).thenReturn(List.of(action));

        OperationsInstanceDiagnosisResponse response = fixture.service.diagnose(
                4L, "main", "task_a", "2026-10-06", fixture.accessibleGroups());

        assertThat(response.state()).isEqualTo("SUCCESS");
        assertThat(response.executions()).extracting("id").containsExactly("exec-rerun", "exec-original");
        assertThat(response.executions().getFirst().rerun()).isTrue();
        assertThat(response.executions().getFirst().plannedAt()).isEqualTo(Instant.parse("2026-10-06T02:00:00Z"));
        assertThat(response.executions().get(1).rerun()).isFalse();
    }

    @Test
    void upstreamUnsynced_whenFlowMissingInKestra() {
        Fixture fixture = new Fixture();
        fixture.stubOwnFlow(dailyFlowYaml("2:task_b", null, false));
        fixture.stubExecutions("g4-main", "task_a", List.of(
                execution("exec-a", "g4-main", "task_a", "SUCCESS", "2026-10-06T02:00:00Z",
                        "2026-10-06T02:00:05Z", List.of(), Map.of())));
        when(fixture.kestraClient.getFlowSource("g2-main", "task_b"))
                .thenThrow(new ResponseStatusException(HttpStatus.NOT_FOUND, "not found"));

        OperationsInstanceDiagnosisResponse response = fixture.service.diagnose(
                4L, "main", "task_a", "2026-10-06", fixture.accessibleGroups());

        assertThat(response.state()).isEqualTo("SUCCESS");
        assertThat(response.upstreams().getFirst().state())
                .isEqualTo(OperationsInstanceDiagnosisService.STATE_UNSYNCED);
        assertThat(response.upstreams().getFirst().satisfied()).isFalse();
    }

    @Test
    void upstreamAccessibleFlag_followsGroupPermission() {
        Fixture fixture = new Fixture();
        fixture.stubOwnFlow(dailyFlowYaml("2:task_b", null, false));
        fixture.stubExecutions("g4-main", "task_a", List.of(
                execution("exec-a", "g4-main", "task_a", "SUCCESS", "2026-10-06T02:00:00Z",
                        "2026-10-06T02:00:05Z", List.of(), Map.of())));
        fixture.stubUpstreamFlow("g2-main", "task_b");
        fixture.stubExecutions("g2-main", "task_b", List.of());

        OperationsInstanceDiagnosisResponse response = fixture.service.diagnose(
                4L, "main", "task_a", "2026-10-06",
                List.of(new ProjectGroupContextItem(4L, "组四", null, "GROUP_ADMIN")));

        assertThat(response.upstreams().getFirst().accessible()).isFalse();
        assertThat(response.upstreams().getFirst().groupName()).isNull();
    }

    @Test
    void branchNotSynced_rejected() {
        Fixture fixture = new Fixture();
        when(fixture.gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(List.of());

        assertThatThrownBy(() -> fixture.service.diagnose(4L, "main", "task_a", null, fixture.accessibleGroups()))
                .isInstanceOfSatisfying(ResponseStatusException.class, exception ->
                        assertThat(exception.getReason()).contains("分支未配置同步"));
    }

    @Test
    void scheduleKeyWithoutFireInPeriod_rejected() {
        Fixture fixture = new Fixture();
        fixture.stubOwnFlow("""
                id: task_a
                namespace: g4-main
                labels:
                  wbdataSchedulePeriod: DAILY
                triggers:
                  - id: schedule
                    type: io.kestra.plugin.core.trigger.Schedule
                    cron: "0 2 1 * *"
                tasks: []
                """);

        assertThatThrownBy(() -> fixture.service.diagnose(
                4L, "main", "task_a", "2026-10-06", fixture.accessibleGroups()))
                .isInstanceOfSatisfying(ResponseStatusException.class, exception ->
                        assertThat(exception.getReason()).contains("没有计划点火时间"));
    }

    @Test
    void diagnoseByExecution_locatesScheduleKeyFromPlannedTime() {
        Fixture fixture = new Fixture();
        fixture.stubOwnFlow(dailyFlowYaml(null, null, false));
        when(fixture.kestraClient.getExecution("exec-1")).thenReturn(
                execution("exec-1", "g4-main", "task_a", "SUCCESS", "2026-10-06T02:00:00Z",
                        "2026-10-06T02:00:05Z", List.of(), Map.of()));
        fixture.stubExecutions("g4-main", "task_a", List.of(
                execution("exec-1", "g4-main", "task_a", "SUCCESS", "2026-10-06T02:00:00Z",
                        "2026-10-06T02:00:05Z", List.of(), Map.of())));

        OperationsInstanceDiagnosisResponse response = fixture.service.diagnoseByExecution(
                4L, "exec-1", fixture.accessibleGroups());

        assertThat(response.branch()).isEqualTo("main");
        assertThat(response.flowId()).isEqualTo("task_a");
        assertThat(response.scheduleKey()).isEqualTo("2026-10-06");
        assertThat(response.state()).isEqualTo("SUCCESS");
    }

    @Test
    void diagnoseByExecution_rejectsExecutionOutsideGroupScope() {
        Fixture fixture = new Fixture();
        when(fixture.kestraClient.getExecution("exec-x")).thenReturn(
                execution("exec-x", "g9-main", "other", "SUCCESS", "2026-10-06T02:00:00Z",
                        "2026-10-06T02:00:05Z", List.of(), Map.of()));

        assertThatThrownBy(() -> fixture.service.diagnoseByExecution(4L, "exec-x", fixture.accessibleGroups()))
                .isInstanceOfSatisfying(ResponseStatusException.class, exception -> {
                    assertThat(exception.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
                    assertThat(exception.getReason()).isEqualTo("执行记录不存在");
                });
    }

    private static String dailyFlowYaml(String dependencies, String failurePolicy, boolean disabled) {
        StringBuilder labels = new StringBuilder("labels:\n  wbdataSchedulePeriod: DAILY\n");
        if (dependencies != null) {
            labels.append("  wbdataDependencies: \"").append(dependencies).append("\"\n");
        }
        if (failurePolicy != null) {
            labels.append("  wbdataFailurePolicy: ").append(failurePolicy).append("\n");
        }
        return """
                id: task_a
                namespace: g4-main
                %striggers:
                  - id: schedule
                    type: io.kestra.plugin.core.trigger.Schedule
                    cron: "0 2 * * *"
                %s
                tasks: []
                """.formatted(labels.toString(), disabled ? "    disabled: true" : "");
    }

    private static KestraExecutionSnapshot execution(String id,
                                                     String namespace,
                                                     String flowId,
                                                     String status,
                                                     String plannedAt,
                                                     String createdAt,
                                                     List<KestraTaskRunSnapshot> taskRuns,
                                                     Map<String, String> inputs) {
        return new KestraExecutionSnapshot(
                id,
                namespace,
                flowId,
                status,
                plannedAt == null ? null : Instant.parse(plannedAt),
                createdAt == null ? null : Instant.parse(createdAt),
                createdAt == null ? null : Instant.parse(createdAt),
                null,
                taskRuns,
                inputs,
                Map.of()
        );
    }

    private static KestraTaskRunSnapshot taskRun(String taskId, String status) {
        return new KestraTaskRunSnapshot(taskId, status, null, null);
    }

    private static final class Fixture {
        private final GitSyncConfigService gitSyncConfigService = Mockito.mock(GitSyncConfigService.class);
        private final KestraClient kestraClient = Mockito.mock(KestraClient.class);
        private final WbOperationExecutionActionMapper actionMapper = Mockito.mock(WbOperationExecutionActionMapper.class);
        private final PermissionService permissionService = Mockito.mock(PermissionService.class);
        private final OperationsInstanceDiagnosisService service;

        private Fixture() {
            this(NOW);
        }

        private Fixture(Instant now) {
            service = new OperationsInstanceDiagnosisService(
                    gitSyncConfigService, kestraClient, actionMapper, permissionService);
            service.useClock(Clock.fixed(now, ZoneOffset.UTC));
            when(gitSyncConfigService.listEnabledSyncConfigs(4L)).thenReturn(List.of(syncConfig("main", "g4-main")));
            when(permissionService.resolveProjectPermissions(Mockito.any(), Mockito.anyBoolean()))
                    .thenReturn(List.of(Permission.OFFLINE_READ.code()));
        }

        private List<ProjectGroupContextItem> accessibleGroups() {
            return List.of(
                    new ProjectGroupContextItem(4L, "组四", null, "GROUP_ADMIN"),
                    new ProjectGroupContextItem(2L, "组二", null, "GROUP_ADMIN")
            );
        }

        private void stubOwnFlow(String yaml) {
            when(kestraClient.getFlowSource("g4-main", "task_a")).thenReturn(yaml);
        }

        private void stubUpstreamFlow(String namespace, String flowId) {
            when(kestraClient.getFlowSource(namespace, flowId)).thenReturn("""
                    id: %s
                    namespace: %s
                    labels:
                      wbdataSchedulePeriod: DAILY
                    triggers:
                      - id: schedule
                        type: io.kestra.plugin.core.trigger.Schedule
                        cron: "0 1 * * *"
                    tasks: []
                    """.formatted(flowId, namespace));
        }

        private void stubExecutions(String namespace, String flowId, List<KestraExecutionSnapshot> executions) {
            when(kestraClient.searchExecutions(argThat(filters ->
                    filters != null
                            && namespace.equals(filters.get("filters[namespace][EQUALS]"))
                            && flowId.equals(filters.get("filters[flowId][EQUALS]")))))
                    .thenReturn(executions);
        }

        private static GitSyncConfigResponse syncConfig(String branch, String namespace) {
            return new GitSyncConfigResponse(
                    1L, 4L, branch, namespace, "sync-flows-" + namespace, true,
                    LocalDateTime.parse("2026-06-07T00:00:00"), null, null);
        }
    }
}
