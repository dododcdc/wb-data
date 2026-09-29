package com.wbdata.offline.service;

import com.wbdata.offline.dto.OfflineFlowDependencyRef;
import com.wbdata.offline.dto.OfflineFlowSchedule;
import com.wbdata.offline.enums.OfflineCrossGroupDependency;
import com.wbdata.offline.enums.OfflineFailurePolicy;
import com.wbdata.offline.enums.OfflineSchedulePeriod;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import org.yaml.snakeyaml.Yaml;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 依赖闸门编译注入：applyDependencyGate 由 applySchedule / applyDependencyConfig / compileGraph 收尾链式调用，
 * buildDebugFlow 负责剥除（debug 旁路，已拍板）。
 */
class OfflineFlowDependencyGateTest {

    private final OfflineFlowYamlSupport support = new OfflineFlowYamlSupport();
    private final Yaml yaml = new Yaml();

    @Test
    @SuppressWarnings("unchecked")
    void applyDependencyConfig_injectsGateAsFirstTask() {
        String source = gatedSource();

        Map<String, Object> root = yaml.load(source);
        List<Map<String, Object>> tasks = (List<Map<String, Object>>) root.get("tasks");
        Map<String, Object> gate = tasks.getFirst();

        assertThat(gate.get("id")).isEqualTo("wb_upstream_gate");
        assertThat(gate.get("type")).isEqualTo("io.wbdata.kestra.core.WaitUpstream");
        assertThat(gate.get("selfGroupId")).isEqualTo("4");
        assertThat((List<Map<String, Object>>) gate.get("upstreams"))
                .containsExactly(
                        Map.of("groupId", "3", "flowId", "ods_user"),
                        Map.of("groupId", "5", "flowId", "ods_order"));
        assertThat(gate.get("period")).isEqualTo("DAILY");
        assertThat(gate.get("cron")).isEqualTo("0 2 * * *");
        assertThat(gate.get("timezone")).isEqualTo("Asia/Shanghai");
        assertThat(gate.get("plannedTime")).isEqualTo("{{ inputs.wbdata_planned_time ?? trigger.date }}");
        assertThat(gate.get("failurePolicy")).isEqualTo("PAUSE");
        assertThat(gate.get("bypass")).isEqualTo("{{ inputs.wbdata_bypass_gate ?? false }}");
        assertThat(tasks.get(1).get("id")).isEqualTo("flow_dag");
    }

    @Test
    @SuppressWarnings("unchecked")
    void applyDependencyConfig_declaresGateInputs() {
        Map<String, Object> root = yaml.load(gatedSource());
        List<Map<String, Object>> inputs = (List<Map<String, Object>>) root.get("inputs");

        assertThat(inputs).anySatisfy(input -> {
            assertThat(input.get("id")).isEqualTo("wbdata_planned_time");
            assertThat(input.get("type")).isEqualTo("DATETIME");
            assertThat(input.get("required")).isEqualTo(false);
        });
        assertThat(inputs).anySatisfy(input -> {
            assertThat(input.get("id")).isEqualTo("wbdata_bypass_gate");
            assertThat(input.get("type")).isEqualTo("BOOL");
            assertThat(input.get("defaults")).isEqualTo(false);
        });
    }

    @Test
    @SuppressWarnings("unchecked")
    void applyDependencyGate_isIdempotent() {
        String once = gatedSource();
        String twice = support.applyDependencyGate(once);

        List<Map<String, Object>> tasks = (List<Map<String, Object>>) yaml.<Map<String, Object>>load(twice).get("tasks");
        assertThat(tasks.stream().filter(task -> "wb_upstream_gate".equals(task.get("id")))).hasSize(1);
    }

    @Test
    @SuppressWarnings("unchecked")
    void applyDependencyConfig_removesGateWhenDependenciesCleared() {
        String cleared = support.applyDependencyConfig(gatedSource(), List.of(), null, null);

        Map<String, Object> root = yaml.load(cleared);
        List<Map<String, Object>> tasks = (List<Map<String, Object>>) root.get("tasks");
        assertThat(tasks.stream().map(task -> task.get("id"))).containsExactly("flow_dag");
        // 旁路 input 随闸门剥除；wbdata_planned_time 与参数编译共享所有权，保守保留
        assertThat((List<Map<String, Object>>) root.get("inputs"))
                .noneSatisfy(input -> assertThat(input.get("id")).isEqualTo("wbdata_bypass_gate"));
    }

    @Test
    void applyDependencyGate_rejectsCustomPeriod() {
        String customCronFlow = """
                id: orders
                namespace: pg-4
                labels:
                  wbdataDependencies: "3:ods_user"
                triggers:
                  - id: schedule
                    type: io.kestra.plugin.core.trigger.Schedule
                    cron: "*/5 * * * *"
                tasks: []
                """;

        assertThatThrownBy(() -> support.applyDependencyGate(customCronFlow))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("标准调度频率");
    }

    @Test
    void applyDependencyGate_rejectsMissingSchedule() {
        String noSchedule = """
                id: orders
                namespace: pg-4
                labels:
                  wbdataDependencies: "3:ods_user"
                tasks: []
                """;

        assertThatThrownBy(() -> support.applyDependencyGate(noSchedule))
                .isInstanceOf(ResponseStatusException.class);
    }

    @Test
    @SuppressWarnings("unchecked")
    void compileGraph_keepsGateAsFirstTask() {
        String compiled = support.compileGraph(
                gatedSource(),
                List.of(new OfflineFlowNode("task_a", "SHELL", "scripts/task_a.sh", null, null, null)),
                List.of(),
                Map.of());

        List<Map<String, Object>> tasks = (List<Map<String, Object>>) yaml.<Map<String, Object>>load(compiled).get("tasks");
        assertThat(tasks.stream().map(task -> task.get("id")))
                .containsExactly("wb_upstream_gate", "flow_dag");
    }

    @Test
    @SuppressWarnings("unchecked")
    void buildDebugFlow_stripsGateAndBypassInput() {
        String debug = support.buildDebugFlow(
                gatedSource(),
                "wb-debug-g4-bmain-u1",
                "_flows/orders/flow.yaml",
                4L,
                1L,
                "main",
                "revision",
                "ALL",
                List.of());

        Map<String, Object> root = yaml.load(debug);
        List<Map<String, Object>> tasks = (List<Map<String, Object>>) root.get("tasks");
        assertThat(tasks.stream().map(task -> task.get("id"))).containsExactly("flow_dag");
        assertThat((List<Map<String, Object>>) root.get("inputs"))
                .noneSatisfy(input -> assertThat(input.get("id")).isEqualTo("wbdata_bypass_gate"));
        assertThat(root.get("triggers")).isNull();
    }

    @Test
    @SuppressWarnings("unchecked")
    void applyDependencyGate_preservesParameterInputs() {
        String withParameterInputs = """
                id: orders
                namespace: pg-4
                labels:
                  wbdataDependencies: "3:ods_user"
                  wbdataSchedulePeriod: DAILY
                inputs:
                  - id: biz_date
                    type: STRING
                    defaults: "2026-01-01"
                triggers:
                  - id: schedule
                    type: io.kestra.plugin.core.trigger.Schedule
                    cron: "0 2 * * *"
                tasks: []
                """;

        Map<String, Object> root = yaml.load(support.applyDependencyGate(withParameterInputs));
        List<Map<String, Object>> inputs = (List<Map<String, Object>>) root.get("inputs");

        assertThat(inputs.stream().map(input -> input.get("id")))
                .containsExactly("biz_date", "wbdata_planned_time", "wbdata_bypass_gate");
    }

    /** 含两个前置、PAUSE 策略、上海时区天调度的完整任务 YAML（闸门已由链式调用注入）。 */
    private String gatedSource() {
        String source = support.buildEmptyFlowYaml("orders", "pg-4");
        source = support.compileGraph(
                source,
                List.of(new OfflineFlowNode("task_a", "SHELL", "scripts/task_a.sh", null, null, null)),
                List.of(),
                Map.of());
        source = support.applySchedule(source,
                new OfflineFlowSchedule("0 2 * * *", "Asia/Shanghai", true, OfflineSchedulePeriod.DAILY));
        return support.applyDependencyConfig(source,
                List.of(new OfflineFlowDependencyRef(3L, "ods_user"), new OfflineFlowDependencyRef(5L, "ods_order")),
                OfflineFailurePolicy.PAUSE, OfflineCrossGroupDependency.ALLOW);
    }
}
