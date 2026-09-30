package com.wbdata.offline.service;

import com.wbdata.offline.dto.FlowParameterDefinitionSnapshot;
import com.wbdata.offline.dto.FlowParameterSnapshot;
import com.wbdata.offline.transfer.dto.TransferConfig;
import com.wbdata.offline.transfer.dto.TransferEndpointConfig;
import com.wbdata.offline.transfer.dto.TransferFieldMapping;
import com.wbdata.offline.transfer.dto.TransferMappingKind;
import com.wbdata.offline.transfer.dto.TransferPartitionMapping;
import com.wbdata.offline.transfer.dto.TransferWriteMode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
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
                Map.of("scripts/query.sql", "select * from users where name=^[name] "
                        + "and plan_day=^[v_plan_day] and start_day=^[v_start_day]"), Map.of()
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
                Map.of("scripts/query.sql", "select * from users where day=^[v_day]"), Map.of()
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
                Map.of("scripts/query.sql", "select ^[v_local_time]"), Map.of()
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
                Map.of("scripts/query.sql", "select ^[v_day]"), Map.of()
        ))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("时间基准不支持");
    }

    @Test
    void validatesEachSqlNodeAndReportsItsMissingParameter() {
        assertThatThrownBy(() -> compiler.compile(
                snapshot(List.of(constant("name", "小明", 0))),
                List.of(sqlNode("user_filter")),
                Map.of("scripts/query.sql", "select * from users where day=^[v_day]"), Map.of()
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
                Map.of("scripts/query.sql", "select ^[name]"), Map.of()
        ))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("未定义参数: name");
    }

    @Test
    void shellCollectsOnlyParametersDefinedInTheSnapshot() {
        FlowParameterCompiler.Compilation result = compiler.compile(
                snapshot(List.of(constant("name", "小明", 0))),
                List.of(new OfflineFlowNode(
                        "shell_1", "SHELL", "scripts/task.sh", null, null, null)),
                Map.of("scripts/task.sh", "echo ^[name] ^[abc]\ngrep ^[a-z]"), Map.of()
        );

        assertThat(result.parametersForTask("shell_1")).contains("\"name\": inputs.name")
                .doesNotContain("abc");
    }

    @Test
    void hiveCollectsValueAndIdentifierParametersAndKeepsQuotedRegex() {
        FlowParameterCompiler.Compilation result = compiler.compile(
                snapshot(List.of(constant("name", "小明", 0), constant("DWD", "dwd", 1))),
                List.of(new OfflineFlowNode(
                        "hive_1", "HIVE_SQL", "scripts/task.hql", null, null, null)),
                Map.of("scripts/task.hql",
                        "select ^[name] from ^[DWD].orders where name rlike '^[abc]'"),
                Map.of()
        );

        assertThat(result.parametersForTask("hive_1"))
                .contains("\"name\": inputs.name", "\"DWD\": inputs.DWD")
                .doesNotContain("abc");
    }

    @Test
    void hiveRejectsQuotedDefinedParametersAndUndefinedReferences() {
        assertThatThrownBy(() -> compiler.compile(
                snapshot(List.of(constant("name", "小明", 0))),
                List.of(new OfflineFlowNode(
                        "hive_1", "HIVE_SQL", "scripts/task.hql", null, null, null)),
                Map.of("scripts/task.hql", "select '^[name]'"), Map.of()
        ))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("HiveSQL 节点“hive_1”")
                .hasMessageContaining("不能位于引号内");
        assertThatThrownBy(() -> compiler.compile(
                snapshot(List.of(constant("name", "小明", 0))),
                List.of(new OfflineFlowNode(
                        "hive_1", "HIVE_SQL", "scripts/task.hql", null, null, null)),
                Map.of("scripts/task.hql", "select ^[missing]"), Map.of()
        ))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("未定义参数: missing");
    }

    @Test
    void allowsColonTextAndPostgresqlCastsWithSqlAwareKestraTask() {
        FlowParameterCompiler.Compilation result = compiler.compile(
                snapshot(List.of(constant("name", "小明", 0))),
                List.of(sqlNode("query")),
                Map.of("scripts/query.sql", "select 'a:tom,b:jack', created_at::date where name=^[name]"), Map.of()
        );

        assertThat(result.parametersForTask("query")).contains("\"name\": inputs.name");
    }

    @Test
    void rejectsQuotedTemplateParametersWithActionableMessage() {
        assertThatThrownBy(() -> compiler.compile(
                snapshot(List.of(constant("name", "小明", 0))),
                List.of(sqlNode("query")),
                Map.of("scripts/query.sql", "select '^[name]'"), Map.of()
        ))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("不能位于引号内")
                .hasMessageContaining("移除占位符两侧的引号");
    }

    @Test
    void collectsTransferFixedExpressionWherePrePostAndPartitionReferences() {
        TransferConfig jdbc = transfer("status = ^[filter]", "^[fixed]", "coalesce(^[expression], id)",
                List.of("delete from audit where day = ^[pre]"), List.of("insert into audit values (^[post])"));
        TransferConfig hive = new TransferConfig(jdbc.source(),
                new TransferEndpointConfig(2L, "HIVE", "warehouse", "orders", null,
                        TransferWriteMode.OVERWRITE_PARTITION, null, null),
                List.of(), List.of(new TransferPartitionMapping("dt", TransferMappingKind.STATIC_VALUE,
                        null, null, "day-^[partition]")));
        var result = compiler.compile(snapshot(List.of(
                        constant("fixed", "x", 0), constant("expression", "x", 1), constant("filter", "x", 2),
                        constant("pre", "x", 3), constant("post", "x", 4), constant("partition", "x", 5),
                        constant("unused", "x", 6))),
                List.of(transferNode("jdbc"), transferNode("hive")), Map.of(), Map.of("jdbc", jdbc, "hive", hive));

        assertThat(result.parametersForTask("jdbc")).isEqualTo("{{ {\"fixed\": inputs.fixed, "
                + "\"expression\": inputs.expression, \"filter\": inputs.filter, "
                + "\"pre\": inputs.pre, \"post\": inputs.post} | toJson }}");
        assertThat(result.parametersForTask("hive")).isEqualTo(
                "{{ {\"filter\": inputs.filter, \"partition\": inputs.partition} | toJson }}");
    }

    @Test
    void transferReusesJdbcPlannedAndStartTimeExpressionsInFlowTimezone() {
        var result = compiler.compile(new FlowParameterSnapshot(2, "America/New_York", "daily_common", 3,
                        List.of(systemTime("plan", "PLANNED_TIME", "yyyyMMdd", -1, 0),
                                systemTime("start", "EXECUTION_START_TIME", "yyyy-MM-dd HH:mm", 0, 1))),
                List.of(sqlNode("query"), transferNode("transfer")),
                Map.of("scripts/query.sql", "select ^[plan], ^[start]"),
                Map.of("transfer", transfer(null, "prefix-^[plan]-^[start]-suffix", "id", null, null)));

        assertThat(result.parametersForTask("transfer")).isEqualTo(result.parametersForTask("query"))
                .contains("inputs.wbdata_planned_time ?? trigger.date", "execution.startDate",
                        "dateAdd(-1, \"DAYS\"", "timeZone=\"America/New_York\"");
    }

    @Test
    void rejectsUndefinedTransferParametersButToleratesMissingTransferConfig() {
        assertThatThrownBy(() -> compiler.compile(null, List.of(transferNode("orders")), Map.of(),
                Map.of("orders", transfer(null, "^[missing]", "id", null, null))))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("传输 节点“orders”")
                .hasMessageContaining("未定义参数: missing");
        // 3febdb9 起草稿保存容忍未配置传输规则的 TRANSFER 节点（无引用继续编译）；
        // 执行/提交前的拦截在 OfflineFlowDocumentService 的卡点，不在编译器
        assertThat(compiler.compile(null, List.of(transferNode("orders")), Map.of(), Map.of()))
                .isNotNull();
    }

    @ParameterizedTest
    @ValueSource(strings = {"where", "expression", "pre", "post"})
    void rejectsQuotedTransferSqlParameters(String location) {
        TransferConfig config = transfer("where".equals(location) ? "id = '^[name]'" : null,
                "literal", "expression".equals(location) ? "'^[name]'" : "id",
                "pre".equals(location) ? List.of("select '^[name]'") : null,
                "post".equals(location) ? List.of("select '^[name]'") : null);
        assertThatThrownBy(() -> compiler.compile(snapshot(List.of(constant("name", "x", 0))),
                List.of(transferNode("orders")), Map.of(), Map.of("orders", config)))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("传输 节点“orders”")
                .hasMessageContaining("不能位于引号内");
    }

    @ParameterizedTest
    @ValueSource(strings = {"sourceDatabase", "sourceTable", "targetDatabase", "targetTable", "sourceField", "targetField", "partitionField"})
    void rejectsDynamicTransferIdentifiers(String location) {
        TransferConfig config = new TransferConfig(
                new TransferEndpointConfig(1L, "MYSQL", identifier(location, "sourceDatabase"),
                        identifier(location, "sourceTable"), null, null, null, null),
                new TransferEndpointConfig(2L, "HIVE", identifier(location, "targetDatabase"),
                        identifier(location, "targetTable"), null, TransferWriteMode.APPEND, null, null),
                List.of(new TransferFieldMapping(identifier(location, "targetField"), TransferMappingKind.SOURCE_FIELD,
                        identifier(location, "sourceField"), null)),
                List.of(new TransferPartitionMapping(identifier(location, "partitionField"),
                        TransferMappingKind.STATIC_VALUE, null, null, "20260101")));
        assertThatThrownBy(() -> compiler.compile(snapshot(List.of(constant("name", "x", 0))),
                List.of(transferNode("orders")), Map.of(), Map.of("orders", config)))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("数据库名、表名和字段名不支持参数占位符");
    }

    @Test
    void ignoresTransferParametersInsideSqlComments() {
        TransferConfig config = transfer("id = 1 -- ^[missing_where]\n", "literal",
                "id /* ^[missing_expression] */", List.of("select 1 -- ^[missing_pre]\n"),
                List.of("select 1 /* ^[missing_post] */"));
        var result = compiler.compile(null, List.of(transferNode("orders")), Map.of(), Map.of("orders", config));
        assertThat(result.taskParameterExpressions()).isEmpty();
    }

    private String identifier(String location, String field) {
        return location.equals(field) ? "^[name]" : field;
    }

    private TransferConfig transfer(String where, String fixed, String expression, List<String> pre, List<String> post) {
        return new TransferConfig(
                new TransferEndpointConfig(1L, "MYSQL", "sales", "orders", where, null, null, null),
                new TransferEndpointConfig(2L, "MYSQL", "warehouse", "orders", null, TransferWriteMode.APPEND, pre, post),
                List.of(new TransferFieldMapping("label", TransferMappingKind.STATIC_VALUE, null, null, fixed),
                        new TransferFieldMapping("id", TransferMappingKind.SOURCE_EXPRESSION, null, expression)), List.of());
    }

    private OfflineFlowNode transferNode(String taskId) {
        return new OfflineFlowNode(taskId, "TRANSFER", null, null, null, "transfers/" + taskId + ".json");
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
