package com.wbdata.offline.service;

import com.wbdata.offline.dto.FlowParameterDefinitionSnapshot;
import com.wbdata.offline.dto.FlowParameterSnapshot;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class FlowParameterCompilerTest {
    private final FlowParameterCompiler compiler = new FlowParameterCompiler();

    @Test
    void compilesStringInputsAndExplicitTimeBases() {
        FlowParameterCompiler.Compilation result = compiler.compile(
                snapshot(List.of(
                        constant("name", "小明", 0),
                        constant("count", "007", 1),
                        systemTime("v_plan_day", "PLANNED_TIME", "yyyyMMdd", -1, 2),
                        systemTime("v_start_day", "EXECUTION_START_TIME", "yyyyMMdd", 0, 3)
                )),
                List.of(sqlNode("query")),
                Map.of("scripts/query.sql", "select * from users where name=${name} "
                        + "and plan_day=${v_plan_day} and start_day=${v_start_day}")
        );

        assertThat(result.inputs()).containsExactly(
                Map.of("id", "name", "type", "STRING", "defaults", "小明"),
                Map.of("id", "count", "type", "STRING", "defaults", "007"),
                Map.of("id", "v_plan_day", "type", "STRING", "required", false),
                Map.of("id", "v_start_day", "type", "STRING", "required", false),
                Map.of("id", "wbdata_planned_time", "type", "DATETIME", "required", false)
        );
        assertThat(result.parametersForTask("query")).isEqualTo(
                "{{ {\"name\": inputs.name, "
                        + "\"v_plan_day\": (inputs.v_plan_day ?? ((inputs.wbdata_planned_time ?? trigger.date) "
                        + "| timestampMilli | dateAdd(-1, \"DAYS\", format=\"yyyyMMdd\", "
                        + "timeZone=\"Asia/Shanghai\"))), "
                        + "\"v_start_day\": (inputs.v_start_day ?? (execution.startDate "
                        + "| date(\"yyyyMMdd\", timeZone=\"Asia/Shanghai\")))} | toJson }}"
        );
    }

    @Test
    void rejectsSystemTimeWhenFlowTimezoneIsMissing() {
        assertThatThrownBy(() -> compiler.compile(
                new FlowParameterSnapshot(2, null, "daily_common", 3, List.of(
                        new FlowParameterDefinitionSnapshot(
                                "v_day", "SYSTEM_TIME", null, "yyyyMMdd",
                                0, null, 0, "PLANNED_TIME"
                        )
                )),
                List.of(sqlNode("query")),
                Map.of("scripts/query.sql", "select * from users where day=${v_day}")
        ))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("任务运行时区不能为空");
    }

    @Test
    void compilesDayOffsetInFlowTimezoneForDstCalendarSemantics() {
        FlowParameterCompiler.Compilation result = compiler.compile(
                new FlowParameterSnapshot(2, "America/New_York", "daily_common", 3, List.of(
                        systemTime("v_local_time", "PLANNED_TIME", "yyyy-MM-dd HH:mm XXX", 1, 0)
                )),
                List.of(sqlNode("query")),
                Map.of("scripts/query.sql", "select ${v_local_time}")
        );

        assertThat(result.parametersForTask("query")).contains(
                "| timestampMilli | dateAdd(1, \"DAYS\", format=\"yyyy-MM-dd HH:mm XXX\", "
                        + "timeZone=\"America/New_York\")"
        );
    }

    @Test
    void rejectsUnsupportedTimeBasis() {
        assertThatThrownBy(() -> compiler.compile(
                snapshot(List.of(systemTime("v_day", "NOW", "yyyyMMdd", 0, 0))),
                List.of(sqlNode("query")),
                Map.of("scripts/query.sql", "select ${v_day}")
        ))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("时间基准不支持");
    }

    @Test
    void validatesEachSqlNodeAndReportsItsMissingParameter() {
        assertThatThrownBy(() -> compiler.compile(
                snapshot(List.of(constant("name", "小明", 0))),
                List.of(sqlNode("user_filter")),
                Map.of("scripts/query.sql", "select * from users where day=${v_day}")
        ))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("user_filter")
                .hasMessageContaining("v_day");
    }

    @Test
    void sqlParameterWithoutBoundSnapshotIsRejected() {
        assertThatThrownBy(() -> compiler.compile(
                null,
                List.of(sqlNode("query")),
                Map.of("scripts/query.sql", "select ${name}")
        ))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("未定义参数: name");
    }

    @Test
    void ignoresParameterLikeSyntaxInNonSqlNodes() {
        FlowParameterCompiler.Compilation result = compiler.compile(
                snapshot(List.of(constant("name", "小明", 0))),
                List.of(new OfflineFlowNode(
                        "shell", "SHELL", "scripts/task.sh", null, null, null)),
                Map.of("scripts/task.sh", "echo ${name} :undefined")
        );

        assertThat(result.taskParameterExpressions()).isEmpty();
    }

    @Test
    void allowsColonTextAndPostgresqlCastsWithSqlAwareKestraTask() {
        FlowParameterCompiler.Compilation result = compiler.compile(
                snapshot(List.of(constant("name", "小明", 0))),
                List.of(sqlNode("query")),
                Map.of("scripts/query.sql", "select 'a:tom,b:jack', created_at::date where name=${name}")
        );

        assertThat(result.parametersForTask("query")).contains("\"name\": inputs.name");
    }

    @Test
    void rejectsQuotedTemplateParametersWithActionableMessage() {
        assertThatThrownBy(() -> compiler.compile(
                snapshot(List.of(constant("name", "小明", 0))),
                List.of(sqlNode("query")),
                Map.of("scripts/query.sql", "select '${name}'")
        ))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("不能位于引号内")
                .hasMessageContaining("移除占位符两侧的引号");
    }

    private FlowParameterSnapshot snapshot(List<FlowParameterDefinitionSnapshot> definitions) {
        return new FlowParameterSnapshot(2, "Asia/Shanghai", "daily_common", 3, definitions);
    }

    private FlowParameterDefinitionSnapshot constant(String key,
                                                     String value,
                                                     int order) {
        return new FlowParameterDefinitionSnapshot(
                key, "CONSTANT", value, null, 0, null, order, null);
    }

    private FlowParameterDefinitionSnapshot systemTime(String key,
                                                       String timeBasis,
                                                       String format,
                                                       int offset,
                                                       int order) {
        return new FlowParameterDefinitionSnapshot(
                key, "SYSTEM_TIME", null, format, offset, null, order, timeBasis);
    }

    private OfflineFlowNode sqlNode(String taskId) {
        return new OfflineFlowNode(taskId, "MYSQL", "scripts/query.sql", 1L, "MYSQL", null);
    }
}
