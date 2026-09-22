package com.wbdata.offline.service;

import com.wbdata.auth.dto.ProjectGroupContextItem;
import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.dto.OfflineDependencyCandidateResponse;
import com.wbdata.offline.dto.OfflineDependencyConfigResponse;
import com.wbdata.offline.dto.OfflineDependencyItemResponse;
import com.wbdata.offline.dto.OfflineDependentItemResponse;
import com.wbdata.offline.dto.OfflineFlowContentResponse;
import com.wbdata.offline.dto.OfflineFlowDependencyRef;
import com.wbdata.offline.dto.UpdateOfflineDependenciesRequest;
import com.wbdata.offline.enums.OfflineCrossGroupDependency;
import com.wbdata.offline.enums.OfflineFailurePolicy;
import com.wbdata.offline.enums.OfflineSchedulePeriod;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class OfflineFlowDependencyServiceTest {

    @TempDir
    Path tempDir;

    @Test
    void updateConfigPersistsSameGroupDependencyAndReadsBack() throws Exception {
        Fixture fixture = new Fixture();
        fixture.writeFlow(1L, "upstream", fixture.scheduledFlow("upstream", 1L, "0 1 * * *", "DAILY", Map.of()));
        fixture.writeFlow(1L, "downstream", fixture.scheduledFlow("downstream", 1L, "0 2 * * *", "DAILY", Map.of()));

        OfflineDependencyConfigResponse response = fixture.service().updateConfig(
                fixture.request(1L, "_flows/downstream/flow.yaml",
                        List.of(new OfflineFlowDependencyRef(1L, "upstream")),
                        OfflineFailurePolicy.CONTINUE,
                        OfflineCrossGroupDependency.ALLOW),
                fixture.groups(1L));

        assertThat(response.dependencies()).containsExactly(
                new OfflineDependencyItemResponse(1L, "group-1", "upstream",
                        "_flows/upstream/flow.yaml", OfflineSchedulePeriod.DAILY,
                        OfflineCrossGroupDependency.ALLOW, "0 1 * * *", null, true));
        String yaml = fixture.readFlow(1L, "downstream");
        assertThat(yaml).contains("wbdataDependencies: 1:upstream");
        assertThat(yaml).doesNotContain("wbdataFailurePolicy");
        assertThat(yaml).doesNotContain("wbdataCrossGroupDependency");
    }

    @Test
    void updateConfigPersistsCrossGroupDependency() throws Exception {
        Fixture fixture = new Fixture();
        fixture.writeFlow(2L, "ods_user", fixture.scheduledFlow("ods_user", 2L, "0 1 * * *", "DAILY", Map.of()));
        fixture.writeFlow(1L, "dwd_user", fixture.scheduledFlow("dwd_user", 1L, "0 2 * * *", "DAILY", Map.of()));

        OfflineDependencyConfigResponse response = fixture.service().updateConfig(
                fixture.request(1L, "_flows/dwd_user/flow.yaml",
                        List.of(new OfflineFlowDependencyRef(2L, "ods_user")),
                        OfflineFailurePolicy.PAUSE,
                        OfflineCrossGroupDependency.ALLOW),
                fixture.groups(1L, 2L));

        assertThat(response.failurePolicy()).isEqualTo(OfflineFailurePolicy.PAUSE);
        assertThat(response.dependencies().getFirst().groupName()).isEqualTo("group-2");
        assertThat(response.dependencies().getFirst().period()).isEqualTo(OfflineSchedulePeriod.DAILY);
        String yaml = fixture.readFlow(1L, "dwd_user");
        assertThat(yaml).contains("wbdataDependencies: 2:ods_user");
        assertThat(yaml).contains("wbdataFailurePolicy: PAUSE");
    }

    @Test
    void clearingDependenciesRemovesLabel() throws Exception {
        Fixture fixture = new Fixture();
        fixture.writeFlow(1L, "upstream", fixture.scheduledFlow("upstream", 1L, "0 1 * * *", "DAILY", Map.of()));
        fixture.writeFlow(1L, "downstream", fixture.scheduledFlow("downstream", 1L, "0 2 * * *", "DAILY",
                Map.of("wbdataDependencies", "\"1:upstream\"")));

        fixture.service().updateConfig(
                fixture.request(1L, "_flows/downstream/flow.yaml", List.of(),
                        OfflineFailurePolicy.CONTINUE, OfflineCrossGroupDependency.ALLOW),
                fixture.groups(1L));

        assertThat(fixture.readFlow(1L, "downstream")).doesNotContain("wbdataDependencies");
    }

    @Test
    void rejectsSelfDependency() throws Exception {
        Fixture fixture = new Fixture();
        fixture.writeFlow(1L, "task_a", fixture.scheduledFlow("task_a", 1L, "0 1 * * *", "DAILY", Map.of()));

        assertThatThrownBy(() -> fixture.service().updateConfig(
                fixture.request(1L, "_flows/task_a/flow.yaml",
                        List.of(new OfflineFlowDependencyRef(1L, "task_a")),
                        OfflineFailurePolicy.CONTINUE, OfflineCrossGroupDependency.ALLOW),
                fixture.groups(1L)))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getStatusCode().value()).isEqualTo(422))
                .hasMessageContaining("自身");
    }

    @Test
    void rejectsInaccessibleGroupAndMissingFlow() throws Exception {
        Fixture fixture = new Fixture();
        fixture.writeFlow(1L, "task_a", fixture.scheduledFlow("task_a", 1L, "0 1 * * *", "DAILY", Map.of()));
        fixture.writeFlow(2L, "ods_user", fixture.scheduledFlow("ods_user", 2L, "0 1 * * *", "DAILY", Map.of()));

        assertThatThrownBy(() -> fixture.service().updateConfig(
                fixture.request(1L, "_flows/task_a/flow.yaml",
                        List.of(new OfflineFlowDependencyRef(2L, "ods_user")),
                        OfflineFailurePolicy.CONTINUE, OfflineCrossGroupDependency.ALLOW),
                fixture.groups(1L)))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getStatusCode().value()).isEqualTo(422))
                .hasMessageContaining("无权引用");

        assertThatThrownBy(() -> fixture.service().updateConfig(
                fixture.request(1L, "_flows/task_a/flow.yaml",
                        List.of(new OfflineFlowDependencyRef(2L, "missing")),
                        OfflineFailurePolicy.CONTINUE, OfflineCrossGroupDependency.ALLOW),
                fixture.groups(1L, 2L)))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getStatusCode().value()).isEqualTo(422))
                .hasMessageContaining("不存在");
    }

    @Test
    void rejectsDifferentPeriod() throws Exception {
        Fixture fixture = new Fixture();
        fixture.writeFlow(1L, "hourly_upstream", fixture.scheduledFlow("hourly_upstream", 1L, "0 * * * *", "HOURLY", Map.of()));
        fixture.writeFlow(1L, "daily_task", fixture.scheduledFlow("daily_task", 1L, "0 2 * * *", "DAILY", Map.of()));

        assertThatThrownBy(() -> fixture.service().updateConfig(
                fixture.request(1L, "_flows/daily_task/flow.yaml",
                        List.of(new OfflineFlowDependencyRef(1L, "hourly_upstream")),
                        OfflineFailurePolicy.CONTINUE, OfflineCrossGroupDependency.ALLOW),
                fixture.groups(1L)))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getStatusCode().value()).isEqualTo(422))
                .hasMessageContaining("相同调度频率");
    }

    @Test
    void rejectsUnscheduledOrCustomUpstreamAndUnscheduledSelf() throws Exception {
        Fixture fixture = new Fixture();
        fixture.writeFlow(1L, "no_schedule", "id: no_schedule\nnamespace: pg-1\ntasks: []\n");
        fixture.writeFlow(1L, "custom_upstream", fixture.scheduledFlow("custom_upstream", 1L, "0 1,8,13 * * *", "CUSTOM", Map.of()));
        fixture.writeFlow(1L, "daily_task", fixture.scheduledFlow("daily_task", 1L, "0 2 * * *", "DAILY", Map.of()));

        assertThatThrownBy(() -> fixture.service().updateConfig(
                fixture.request(1L, "_flows/daily_task/flow.yaml",
                        List.of(new OfflineFlowDependencyRef(1L, "no_schedule")),
                        OfflineFailurePolicy.CONTINUE, OfflineCrossGroupDependency.ALLOW),
                fixture.groups(1L)))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getStatusCode().value()).isEqualTo(422))
                .hasMessageContaining("未配置标准调度");

        assertThatThrownBy(() -> fixture.service().updateConfig(
                fixture.request(1L, "_flows/daily_task/flow.yaml",
                        List.of(new OfflineFlowDependencyRef(1L, "custom_upstream")),
                        OfflineFailurePolicy.CONTINUE, OfflineCrossGroupDependency.ALLOW),
                fixture.groups(1L)))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getStatusCode().value()).isEqualTo(422))
                .hasMessageContaining("未配置标准调度");

        assertThatThrownBy(() -> fixture.service().updateConfig(
                fixture.request(1L, "_flows/no_schedule/flow.yaml",
                        List.of(new OfflineFlowDependencyRef(1L, "daily_task")),
                        OfflineFailurePolicy.CONTINUE, OfflineCrossGroupDependency.ALLOW),
                fixture.groups(1L)))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getStatusCode().value()).isEqualTo(422))
                .hasMessageContaining("本任务需先配置标准调度");
    }

    @Test
    void rejectsDirectAndIndirectCyclesAcrossGroups() throws Exception {
        Fixture fixture = new Fixture();
        fixture.writeFlow(1L, "task_a", fixture.scheduledFlow("task_a", 1L, "0 1 * * *", "DAILY", Map.of()));
        fixture.writeFlow(1L, "task_b", fixture.scheduledFlow("task_b", 1L, "0 1 * * *", "DAILY",
                Map.of("wbdataDependencies", "\"1:task_a\"")));
        fixture.writeFlow(2L, "task_c", fixture.scheduledFlow("task_c", 2L, "0 1 * * *", "DAILY",
                Map.of("wbdataDependencies", "\"1:task_b\"")));

        assertThatThrownBy(() -> fixture.service().updateConfig(
                fixture.request(1L, "_flows/task_a/flow.yaml",
                        List.of(new OfflineFlowDependencyRef(1L, "task_b")),
                        OfflineFailurePolicy.CONTINUE, OfflineCrossGroupDependency.ALLOW),
                fixture.groups(1L, 2L)))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getStatusCode().value()).isEqualTo(422))
                .hasMessageContaining("循环");

        assertThatThrownBy(() -> fixture.service().updateConfig(
                fixture.request(1L, "_flows/task_a/flow.yaml",
                        List.of(new OfflineFlowDependencyRef(2L, "task_c")),
                        OfflineFailurePolicy.CONTINUE, OfflineCrossGroupDependency.ALLOW),
                fixture.groups(1L, 2L)))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getStatusCode().value()).isEqualTo(422))
                .hasMessageContaining("循环");
    }

    @Test
    void rejectsDuplicatesAndTooManyDependencies() throws Exception {
        Fixture fixture = new Fixture();
        fixture.writeFlow(1L, "task_a", fixture.scheduledFlow("task_a", 1L, "0 1 * * *", "DAILY", Map.of()));
        fixture.writeFlow(1L, "task_b", fixture.scheduledFlow("task_b", 1L, "0 1 * * *", "DAILY", Map.of()));

        assertThatThrownBy(() -> fixture.service().updateConfig(
                fixture.request(1L, "_flows/task_a/flow.yaml",
                        List.of(new OfflineFlowDependencyRef(1L, "task_b"), new OfflineFlowDependencyRef(1L, "task_b")),
                        OfflineFailurePolicy.CONTINUE, OfflineCrossGroupDependency.ALLOW),
                fixture.groups(1L)))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getStatusCode().value()).isEqualTo(422))
                .hasMessageContaining("重复");

        List<OfflineFlowDependencyRef> tooMany = new ArrayList<>();
        for (int index = 0; index < 21; index++) {
            tooMany.add(new OfflineFlowDependencyRef(1L, "flow_" + index));
        }
        assertThatThrownBy(() -> fixture.service().updateConfig(
                fixture.request(1L, "_flows/task_a/flow.yaml", tooMany,
                        OfflineFailurePolicy.CONTINUE, OfflineCrossGroupDependency.ALLOW),
                fixture.groups(1L)))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getStatusCode().value()).isEqualTo(422))
                .hasMessageContaining("上限");
    }

    @Test
    void rejectsCrossGroupDependencyWhenUpstreamDenies() throws Exception {
        Fixture fixture = new Fixture();
        fixture.writeFlow(2L, "ods_user", fixture.scheduledFlow("ods_user", 2L, "0 1 * * *", "DAILY",
                Map.of("wbdataCrossGroupDependency", "DENY")));
        fixture.writeFlow(1L, "dwd_user", fixture.scheduledFlow("dwd_user", 1L, "0 2 * * *", "DAILY", Map.of()));
        fixture.writeFlow(2L, "same_group_downstream", fixture.scheduledFlow("same_group_downstream", 2L, "0 3 * * *", "DAILY", Map.of()));

        assertThatThrownBy(() -> fixture.service().updateConfig(
                fixture.request(1L, "_flows/dwd_user/flow.yaml",
                        List.of(new OfflineFlowDependencyRef(2L, "ods_user")),
                        OfflineFailurePolicy.CONTINUE, OfflineCrossGroupDependency.ALLOW),
                fixture.groups(1L, 2L)))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getStatusCode().value()).isEqualTo(422))
                .hasMessageContaining("不允许跨项目组依赖");

        // 同组依赖不受 DENY 限制
        fixture.service().updateConfig(
                fixture.request(2L, "_flows/same_group_downstream/flow.yaml",
                        List.of(new OfflineFlowDependencyRef(2L, "ods_user")),
                        OfflineFailurePolicy.CONTINUE, OfflineCrossGroupDependency.ALLOW),
                fixture.groups(1L, 2L));
        assertThat(fixture.readFlow(2L, "same_group_downstream")).contains("wbdataDependencies: 2:ods_user");
    }

    @Test
    void deniesClosingCrossGroupSwitchWhenCrossGroupDependentExists() throws Exception {
        Fixture fixture = new Fixture();
        fixture.writeFlow(1L, "task_a", fixture.scheduledFlow("task_a", 1L, "0 1 * * *", "DAILY", Map.of()));
        fixture.writeFlow(2L, "cross_downstream", fixture.scheduledFlow("cross_downstream", 2L, "0 2 * * *", "DAILY",
                Map.of("wbdataDependencies", "\"1:task_a\"")));
        fixture.writeFlow(1L, "local_downstream", fixture.scheduledFlow("local_downstream", 1L, "0 3 * * *", "DAILY",
                Map.of("wbdataDependencies", "\"1:task_a\"")));

        assertThatThrownBy(() -> fixture.service().updateConfig(
                fixture.request(1L, "_flows/task_a/flow.yaml", List.of(),
                        OfflineFailurePolicy.CONTINUE, OfflineCrossGroupDependency.DENY),
                fixture.groups(1L, 2L)))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getStatusCode().value()).isEqualTo(422))
                .hasMessageContaining("跨项目组下游依赖");
    }

    @Test
    void allowsClosingCrossGroupSwitchWithOnlySameGroupDependents() throws Exception {
        Fixture fixture = new Fixture();
        fixture.writeFlow(1L, "task_a", fixture.scheduledFlow("task_a", 1L, "0 1 * * *", "DAILY", Map.of()));
        fixture.writeFlow(1L, "local_downstream", fixture.scheduledFlow("local_downstream", 1L, "0 3 * * *", "DAILY",
                Map.of("wbdataDependencies", "\"1:task_a\"")));

        fixture.service().updateConfig(
                fixture.request(1L, "_flows/task_a/flow.yaml", List.of(),
                        OfflineFailurePolicy.CONTINUE, OfflineCrossGroupDependency.DENY),
                fixture.groups(1L));

        assertThat(fixture.readFlow(1L, "task_a")).contains("wbdataCrossGroupDependency: DENY");
    }

    @Test
    void findDependentsReturnsCrossGroupDownstreams() throws Exception {
        Fixture fixture = new Fixture();
        fixture.writeFlow(1L, "task_a", fixture.scheduledFlow("task_a", 1L, "0 1 * * *", "DAILY", Map.of()));
        fixture.writeFlow(1L, "local_downstream", fixture.scheduledFlow("local_downstream", 1L, "0 3 * * *", "DAILY",
                Map.of("wbdataDependencies", "\"1:task_a\"")));
        fixture.writeFlow(2L, "cross_downstream", fixture.scheduledFlow("cross_downstream", 2L, "0 2 * * *", "DAILY",
                Map.of("wbdataDependencies", "\"1:task_a\"")));
        fixture.writeFlow(2L, "unrelated", fixture.scheduledFlow("unrelated", 2L, "0 2 * * *", "DAILY", Map.of()));

        List<OfflineDependentItemResponse> dependents = fixture.service().findDependents(
                1L, "_flows/task_a/flow.yaml", fixture.groups(1L, 2L));

        assertThat(dependents).extracting(OfflineDependentItemResponse::flowId)
                .containsExactlyInAnyOrder("local_downstream", "cross_downstream");
        assertThat(dependents).extracting(OfflineDependentItemResponse::groupName)
                .containsExactlyInAnyOrder("group-1", "group-2");
    }

    @Test
    void assertDeletionAllowedBlocksWhenDependentExists() throws Exception {
        Fixture fixture = new Fixture();
        fixture.writeFlow(1L, "task_a", fixture.scheduledFlow("task_a", 1L, "0 1 * * *", "DAILY", Map.of()));
        fixture.writeFlow(2L, "cross_downstream", fixture.scheduledFlow("cross_downstream", 2L, "0 2 * * *", "DAILY",
                Map.of("wbdataDependencies", "\"1:task_a\"")));
        fixture.writeFlow(1L, "free_task", fixture.scheduledFlow("free_task", 1L, "0 1 * * *", "DAILY", Map.of()));

        fixture.service().assertDeletionAllowed(1L, "_flows/free_task/flow.yaml", fixture.groups(1L, 2L));

        assertThatThrownBy(() -> fixture.service().assertDeletionAllowed(
                1L, "_flows/task_a/flow.yaml", fixture.groups(1L, 2L)))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getStatusCode().value()).isEqualTo(422))
                .hasMessageContaining("无法删除")
                .hasMessageContaining("cross_downstream");
    }

    @Test
    void assertPeriodChangeAllowedBlocksOnlyWhenDependentsExist() throws Exception {
        Fixture fixture = new Fixture();
        fixture.writeFlow(1L, "task_a", fixture.scheduledFlow("task_a", 1L, "0 1 * * *", "DAILY", Map.of()));
        fixture.writeFlow(1L, "free_task", fixture.scheduledFlow("free_task", 1L, "0 1 * * *", "DAILY", Map.of()));
        fixture.writeFlow(1L, "downstream", fixture.scheduledFlow("downstream", 1L, "0 2 * * *", "DAILY",
                Map.of("wbdataDependencies", "\"1:task_a\"")));

        // 无下游：允许改频率
        fixture.service().assertPeriodChangeAllowed(
                1L, "_flows/free_task/flow.yaml", OfflineSchedulePeriod.HOURLY, fixture.groups(1L));
        // 频率未变：允许
        fixture.service().assertPeriodChangeAllowed(
                1L, "_flows/task_a/flow.yaml", OfflineSchedulePeriod.DAILY, fixture.groups(1L));

        assertThatThrownBy(() -> fixture.service().assertPeriodChangeAllowed(
                1L, "_flows/task_a/flow.yaml", OfflineSchedulePeriod.HOURLY, fixture.groups(1L)))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getStatusCode().value()).isEqualTo(422))
                .hasMessageContaining("不能修改调度频率")
                .hasMessageContaining("downstream");
    }

    @Test
    void searchCandidatesExcludesSelfAndMatchesKeyword() throws Exception {
        Fixture fixture = new Fixture();
        fixture.writeFlow(1L, "task_a", fixture.scheduledFlow("task_a", 1L, "0 1 * * *", "DAILY", Map.of()));
        fixture.writeFlow(1L, "ods_order", fixture.scheduledFlow("ods_order", 1L, "0 1 * * *", "DAILY", Map.of()));
        fixture.writeFlow(2L, "ods_user", fixture.scheduledFlow("ods_user", 2L, "0 1 * * *", "DAILY",
                Map.of("wbdataCrossGroupDependency", "DENY")));
        fixture.writeFlow(2L, "unscheduled", "id: unscheduled\nnamespace: pg-2\ntasks: []\n");

        List<OfflineDependencyCandidateResponse> all = fixture.service().searchCandidates(
                1L, "_flows/task_a/flow.yaml", null, fixture.groups(1L, 2L));
        assertThat(all).extracting(OfflineDependencyCandidateResponse::flowId)
                .containsExactlyInAnyOrder("ods_order", "ods_user", "unscheduled");

        OfflineDependencyCandidateResponse denied = all.stream()
                .filter(candidate -> candidate.flowId().equals("ods_user")).findFirst().orElseThrow();
        assertThat(denied.crossGroupDependency()).isEqualTo(OfflineCrossGroupDependency.DENY);
        OfflineDependencyCandidateResponse unscheduled = all.stream()
                .filter(candidate -> candidate.flowId().equals("unscheduled")).findFirst().orElseThrow();
        assertThat(unscheduled.hasSchedule()).isFalse();
        assertThat(unscheduled.period()).isNull();

        List<OfflineDependencyCandidateResponse> matched = fixture.service().searchCandidates(
                1L, "_flows/task_a/flow.yaml", "ODS", fixture.groups(1L, 2L));
        assertThat(matched).extracting(OfflineDependencyCandidateResponse::flowId)
                .containsExactlyInAnyOrder("ods_order", "ods_user");
    }

    @Test
    void groupMembershipWithoutOfflineReadDoesNotExposeOrAuthorizeReferences() throws Exception {
        Fixture fixture = new Fixture();
        fixture.writeFlow(1L, "self", fixture.scheduledFlow("self", 1L, "0 1 * * *", "DAILY", Map.of()));
        fixture.writeFlow(2L, "restricted", fixture.scheduledFlow("restricted", 2L, "0 1 * * *", "DAILY",
                Map.of("wbdataDependencies", "\"1:self\"")));
        var groups = List.of(
                new ProjectGroupContextItem(1L, "group-1", "", "DEVELOPER"),
                new ProjectGroupContextItem(2L, "group-2", "", "NO_OFFLINE_ACCESS"));

        assertThat(fixture.service().searchCandidates(1L, "_flows/self/flow.yaml", null, groups)).isEmpty();
        assertThat(fixture.service().findDependents(1L, "_flows/self/flow.yaml", groups)).isEmpty();
        assertThatThrownBy(() -> fixture.service().assertDeletionAllowed(1L, "_flows/self/flow.yaml", groups))
                .hasMessageContaining("无权查看")
                .hasMessageNotContaining("restricted");
        assertThatThrownBy(() -> fixture.service().updateConfig(
                fixture.request(1L, "_flows/self/flow.yaml", List.of(new OfflineFlowDependencyRef(2L, "restricted")),
                        OfflineFailurePolicy.CONTINUE, OfflineCrossGroupDependency.ALLOW), groups))
                .hasMessageContaining("无权引用");
    }

    @Test
    void dependencyUpdateKeeps409ForStaleFileVersionsOnly() throws Exception {
        Fixture fixture = new Fixture();
        fixture.writeFlow(1L, "task", fixture.scheduledFlow("task", 1L, "0 1 * * *", "DAILY", Map.of()));
        var stale = fixture.request(1L, "_flows/task/flow.yaml", List.of(),
                OfflineFailurePolicy.CONTINUE, OfflineCrossGroupDependency.ALLOW);
        fixture.service().updateConfig(fixture.request(1L, "_flows/task/flow.yaml", List.of(),
                OfflineFailurePolicy.PAUSE, OfflineCrossGroupDependency.DENY), fixture.groups(1L));
        String before = fixture.readFlow(1L, "task");

        assertThatThrownBy(() -> fixture.service().updateConfig(stale, fixture.groups(1L)))
                .isInstanceOfSatisfying(ResponseStatusException.class, ex -> assertThat(ex.getStatusCode().value()).isEqualTo(409));

        assertThat(fixture.readFlow(1L, "task")).isEqualTo(before);
    }

    @Test
    void candidatesMatchDirectoryNamesAndExposeActualScheduleState() throws Exception {
        Fixture fixture = new Fixture();
        fixture.writeFlow(1L, "self", fixture.scheduledFlow("self", 1L, "0 1 * * *", "DAILY", Map.of()));
        fixture.writeFlow(2L, "业务目录/订单同步", fixture.scheduledFlow("internal_id", 2L, "15 9 * * *", "DAILY", Map.of())
                .replace("    cron:", "    timezone: Asia/Shanghai\n    disabled: true\n    cron:"));
        fixture.writeFlow(2L, "unscheduled", "id: unscheduled\nnamespace: pg-2\ntasks: []\n");

        var matched = fixture.service().searchCandidates(1L, "_flows/self/flow.yaml", "订单同步", fixture.groups(1L, 2L));

        assertThat(matched).hasSize(1);
        assertThat(matched.getFirst().flowId()).isEqualTo("internal_id");
        assertThat(matched.getFirst().cron()).isEqualTo("15 9 * * *");
        assertThat(matched.getFirst().timezone()).isEqualTo("Asia/Shanghai");
        assertThat(matched.getFirst().enabled()).isFalse();
        assertThat(fixture.service().searchCandidates(1L, "_flows/not_saved/flow.yaml", "订单同步", fixture.groups(1L, 2L)))
                .isEqualTo(matched);
        var unscheduled = fixture.service().searchCandidates(1L, "_flows/self/flow.yaml", "unscheduled", fixture.groups(1L, 2L)).getFirst();
        assertThat(unscheduled.cron()).isNull();
        assertThat(unscheduled.timezone()).isNull();
        assertThat(unscheduled.enabled()).isFalse();
        var configured = fixture.service().updateConfig(fixture.request(1L, "_flows/self/flow.yaml",
                List.of(new OfflineFlowDependencyRef(2L, "internal_id")), OfflineFailurePolicy.CONTINUE,
                OfflineCrossGroupDependency.ALLOW), fixture.groups(1L, 2L)).dependencies().getFirst();
        assertThat(configured.cron()).isEqualTo("15 9 * * *");
        assertThat(configured.timezone()).isEqualTo("Asia/Shanghai");
        assertThat(configured.enabled()).isFalse();
        assertThat(fixture.service().getConfig(1L, "_flows/self/flow.yaml", fixture.groups(1L)).dependencies()).isEmpty();
    }

    private class Fixture {
        private final OfflineProperties properties;
        private final RepoLockManager repoLockManager = new RepoLockManager();
        private final OfflineFlowContentService contentService;
        private final OfflineFlowDependencyService service;

        Fixture() {
            properties = new OfflineProperties();
            properties.setRepoBaseDir(tempDir.toString());
            properties.setRepoDirPrefix("wb-data-");
            contentService = new OfflineFlowContentService(
                    properties, repoLockManager, new OfflineKestraFlowFileService(properties));
            service = new OfflineFlowDependencyService(properties, contentService, repoLockManager,
                    new com.wbdata.auth.service.PermissionService());
        }

        OfflineFlowDependencyService service() {
            return service;
        }

        List<ProjectGroupContextItem> groups(long... ids) {
            List<ProjectGroupContextItem> groups = new ArrayList<>();
            for (long id : ids) {
                groups.add(new ProjectGroupContextItem(id, "group-" + id, "", "GROUP_ADMIN"));
            }
            return groups;
        }

        UpdateOfflineDependenciesRequest request(long groupId,
                                                 String path,
                                                 List<OfflineFlowDependencyRef> dependencies,
                                                 OfflineFailurePolicy failurePolicy,
                                                 OfflineCrossGroupDependency crossGroupDependency) {
            OfflineFlowContentResponse content = contentService.getFlowContent(groupId, path);
            return new UpdateOfflineDependenciesRequest(
                    groupId, path, dependencies, failurePolicy, crossGroupDependency,
                    content.contentHash(), content.fileUpdatedAt());
        }

        void writeFlow(long groupId, String flowName, String yaml) throws IOException {
            Path flowFile = properties.resolveRepoPath(groupId)
                    .resolve("_flows").resolve(flowName).resolve("flow.yaml");
            Files.createDirectories(flowFile.getParent());
            Files.writeString(flowFile, yaml);
        }

        String readFlow(long groupId, String flowName) throws IOException {
            return Files.readString(properties.resolveRepoPath(groupId)
                    .resolve("_flows").resolve(flowName).resolve("flow.yaml"));
        }

        String scheduledFlow(String flowId, long groupId, String cron, String period, Map<String, String> extraLabels) {
            StringBuilder labels = new StringBuilder();
            labels.append("  wbdataSchedulePeriod: ").append(period).append('\n');
            extraLabels.forEach((key, value) ->
                    labels.append("  ").append(key).append(": ").append(value).append('\n'));
            return "id: " + flowId + '\n'
                    + "namespace: pg-" + groupId + '\n'
                    + "tasks: []\n"
                    + "triggers:\n"
                    + "  - id: schedule\n"
                    + "    type: io.kestra.plugin.core.trigger.Schedule\n"
                    + "    cron: \"" + cron + "\"\n"
                    + "labels:\n"
                    + labels;
        }
    }
}
