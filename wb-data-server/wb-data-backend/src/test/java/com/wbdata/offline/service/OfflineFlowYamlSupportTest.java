package com.wbdata.offline.service;

import com.wbdata.datasource.entity.DataSource;
import com.wbdata.offline.config.OfflineTransferProperties;
import com.wbdata.offline.enums.OfflineSchedulePeriod;
import com.wbdata.offline.schedule.dto.OfflineFlowSchedule;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import org.yaml.snakeyaml.Yaml;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class OfflineFlowYamlSupportTest {

    @Test
    @SuppressWarnings("unchecked")
    void buildDebugFlow_selectedModePrunesDependenciesToDisabledTasks() {
        OfflineFlowYamlSupport support = new OfflineFlowYamlSupport();
        String source = support.compileGraph(
                support.buildEmptyFlowYaml("orders", "pg-1"),
                List.of(
                        new OfflineFlowNode("task_a", "SHELL", "scripts/task_a.sh", null, null, null),
                        new OfflineFlowNode("task_b", "SHELL", "scripts/task_b.sh", null, null, null),
                        new OfflineFlowNode("task_c", "SHELL", "scripts/task_c.sh", null, null, null)
                ),
                List.of(
                        new OfflineFlowYamlSupport.FlowEdge("task_a", "task_b"),
                        new OfflineFlowYamlSupport.FlowEdge("task_b", "task_c")
                ),
                Map.of()
        );

        String debugFlow = support.buildDebugFlow(
                source,
                "wb-debug-g1-bmain-u1",
                "_flows/orders/flow.yaml",
                1L,
                1L,
                "main",
                "revision",
                "SELECTED",
                List.of("task_b", "task_c")
        );

        Map<String, Object> root = new Yaml().load(debugFlow);
        Map<String, Object> dag = ((List<Map<String, Object>>) root.get("tasks")).getFirst();
        List<Map<String, Object>> dagTasks = (List<Map<String, Object>>) dag.get("tasks");
        Map<String, Object> taskA = dagTasks.get(0);
        Map<String, Object> taskB = dagTasks.get(1);
        Map<String, Object> taskC = dagTasks.get(2);

        assertThat((Map<String, Object>) taskA.get("task")).containsEntry("disabled", true);
        assertThat(taskB).doesNotContainKey("dependsOn");
        assertThat(taskC).containsEntry("dependsOn", List.of("task_b"));
    }

    @Test
    void compileAndParseGraph_roundTripsTransferMetadataAndNamespaceSidecar() {
        OfflineFlowYamlSupport support = new OfflineFlowYamlSupport();
        String transferPath = "transfers/orders/transfer_1.transfer.json";

        String yaml = support.compileGraph(
                support.buildEmptyFlowYaml("orders", "pg-1"),
                List.of(new OfflineFlowNode(
                        "transfer_1", "TRANSFER", null, null, null, transferPath
                )),
                List.of(),
                Map.of()
        );

        OfflineFlowNode node = support.parseDocument(yaml)
                .stages().getFirst().nodes().getFirst();

        assertThat(node.kind()).isEqualTo("TRANSFER");
        assertThat(node.scriptPath()).isNull();
        assertThat(node.transferConfigPath()).isEqualTo(transferPath);
        assertThat(support.collectNamespaceFiles(yaml)).containsExactly(transferPath);
    }

    @Test
    void compileGraph_doesNotUseYamlAnchorsForTransferRunnerVolumes() {
        OfflineTransferProperties transferProperties = new OfflineTransferProperties();
        transferProperties.setDockerVolumes(List.of("wb-data_hive-warehouse:/opt/hive/data/warehouse"));
        OfflineFlowYamlSupport support = new OfflineFlowYamlSupport(transferProperties);

        String yaml = support.compileGraph(
                support.buildEmptyFlowYaml("orders", "pg-1"),
                List.of(
                        new OfflineFlowNode(
                                "transfer_1", "TRANSFER", null, null, null, "transfers/orders/transfer_1.transfer.json"
                        ),
                        new OfflineFlowNode(
                                "transfer_2", "TRANSFER", null, null, null, "transfers/orders/transfer_2.transfer.json"
                        )
                ),
                List.of(),
                Map.of()
        );

        assertThat(yaml).doesNotContain("&id", "*id");
        assertThat(yaml).contains("volumes:\n        - wb-data_hive-warehouse:/opt/hive/data/warehouse");
    }

    @Test
    void parseDocument_upgradesLegacySqlKindFromDataSourceType() {
        OfflineFlowYamlSupport support = new OfflineFlowYamlSupport();
        String yaml = """
                id: orders
                namespace: pg-1
                tasks:
                  - id: flow_dag
                    type: io.kestra.plugin.core.flow.Dag
                    tasks:
                      - task:
                          id: query
                          type: io.wbdata.kestra.jdbc.mysql.Query
                          description: "[wbdata-meta] dataSourceId=1;dataSourceType=MYSQL;nodeKind=SQL"
                          url: jdbc:mysql://db.example:3306/warehouse
                          username: analyst
                          password: secret
                          sql: "{{ read('scripts/query.sql') }}"
                """;

        OfflineFlowNode node = support.parseDocument(yaml)
                .stages().getFirst().nodes().getFirst();

        assertThat(node.kind()).isEqualTo("MYSQL");
        assertThat(node.dataSourceType()).isEqualTo("MYSQL");
        assertThat(node.scriptPath()).isEqualTo("scripts/query.sql");
    }

    @Test
    @SuppressWarnings("unchecked")
    void compileAndParseGraph_roundTripsMysqlNodeKindWithoutPlaintextCredentials() {
        OfflineFlowYamlSupport support = new OfflineFlowYamlSupport();
        DataSource mysql = new DataSource();
        mysql.setId(1L);
        mysql.setGroupId(1L);
        mysql.setType("MYSQL");
        mysql.setHost("db.example");
        mysql.setPort(3306);
        mysql.setDatabaseName("warehouse");
        mysql.setUsername("analyst");
        mysql.setPassword("secret-pw-123");

        String yaml = support.compileGraph(
                support.buildEmptyFlowYaml("orders", "pg-1"),
                List.of(new OfflineFlowNode(
                        "query", "MYSQL", "scripts/query.sql", 1L, "MYSQL", null
                )),
                List.of(),
                Map.of(1L, mysql)
        );

        assertThat(yaml).contains("nodeKind=MYSQL", "dataSourceId: 1", "groupId: 1", "internalToken: '{{ secret(''WB_DATA_INTERNAL_TOKEN'') }}'");
        assertThat(yaml).doesNotContain("secret-pw-123", "jdbc:mysql://", "analyst", "db.example", "password:");
        Map<String, Object> parsedRoot = new Yaml().load(yaml);
        List<Map<String, Object>> dagTasks = (List<Map<String, Object>>) ((List<Map<String, Object>>) parsedRoot.get("tasks")).getFirst().get("tasks");
        Map<String, Object> compiledTask = (Map<String, Object>) dagTasks.getFirst().get("task");
        assertThat(compiledTask).containsEntry("internalToken", "{{ secret('WB_DATA_INTERNAL_TOKEN') }}");
        OfflineFlowNode node = support.parseDocument(yaml)
                .stages().getFirst().nodes().getFirst();
        assertThat(node.kind()).isEqualTo("MYSQL");
    }

    @Test
    void compileAndParseGraph_roundTripsHiveNodeAndUnbindsDataSourceCleanly() {
        OfflineFlowYamlSupport support = new OfflineFlowYamlSupport();
        DataSource hive = new DataSource();
        hive.setId(2L);
        hive.setGroupId(1L);
        hive.setType("HIVE");
        hive.setHost("hive.example");
        hive.setPort(10000);
        hive.setDatabaseName("default");
        hive.setUsername("hive");
        hive.setPassword("hive-secret-pw");

        String yaml = support.compileGraph(
                support.buildEmptyFlowYaml("etl", "pg-1"),
                List.of(new OfflineFlowNode(
                        "hive_step", "HIVE_SQL", "scripts/hive_step.sql", 2L, "HIVE", null
                )),
                List.of(),
                Map.of(2L, hive)
        );

        assertThat(yaml).contains("type: io.wbdata.kestra.hive.Query", "scriptPath: scripts/hive_step.sql");
        assertThat(yaml).doesNotContain("hive-secret-pw", "beeline", "-p ");
        OfflineFlowNode parsed = support.parseGraph(yaml).nodes().getFirst();
        assertThat(parsed.kind()).isEqualTo("HIVE_SQL");
        assertThat(parsed.dataSourceId()).isEqualTo(2L);
        assertThat(parsed.scriptPath()).isEqualTo("scripts/hive_step.sql");

        String unbound = support.unbindSqlDataSources(yaml, java.util.Set.of("hive_step"));
        assertThat(unbound).contains("No data source selected").doesNotContain("io.wbdata.kestra.hive.Query", "dataSourceId: 2");
    }

    @Test
    @SuppressWarnings("unchecked")
    void applySchedule_writesAndRemovesRetryConfig_andDebugStripsRetry() {
        OfflineFlowYamlSupport support = new OfflineFlowYamlSupport();
        String base = support.compileGraph(
                support.buildEmptyFlowYaml("orders", "pg-1"),
                List.of(new OfflineFlowNode("task_a", "SHELL", "scripts/task_a.sh", null, null, null)),
                List.of(),
                Map.of()
        );

        String withRetry = support.applySchedule(base, new OfflineFlowSchedule(
                "0 2 * * *",
                "Asia/Shanghai",
                true,
                OfflineSchedulePeriod.DAILY,
                true,
                3,
                5
        ));
        Map<String, Object> root = new Yaml().load(withRetry);
        Map<String, Object> retry = (Map<String, Object>) root.get("retry");
        assertThat(retry)
                .containsEntry("type", "constant")
                .containsEntry("interval", "PT5M")
                .containsEntry("maxAttempts", 4)
                .containsEntry("behavior", "CREATE_NEW_EXECUTION");

        OfflineFlowYamlSupport.ScheduleData parsed = support.readSchedule(withRetry);
        assertThat(parsed.retryEnabled()).isTrue();
        assertThat(parsed.retryCount()).isEqualTo(3);
        assertThat(parsed.retryIntervalMinutes()).isEqualTo(5);

        String debugFlow = support.buildDebugFlow(
                withRetry,
                "wb-debug-g1-bmain-u1",
                "_flows/orders/flow.yaml",
                1L,
                1L,
                "main",
                "revision",
                "ALL",
                List.of()
        );
        Map<String, Object> debugRoot = new Yaml().load(debugFlow);
        assertThat(debugRoot).doesNotContainKey("retry");

        String disabledRetry = support.applySchedule(withRetry, new OfflineFlowSchedule(
                "0 2 * * *",
                "Asia/Shanghai",
                true,
                OfflineSchedulePeriod.DAILY,
                false,
                null,
                null
        ));
        Map<String, Object> disabledRoot = new Yaml().load(disabledRetry);
        assertThat(disabledRoot).doesNotContainKey("retry");
        OfflineFlowYamlSupport.ScheduleData disabledParsed = support.readSchedule(disabledRetry);
        assertThat(disabledParsed.retryEnabled()).isFalse();
        assertThat(disabledParsed.retryCount()).isNull();
        assertThat(disabledParsed.retryIntervalMinutes()).isNull();
    }

    @Test
    void applySchedule_rejectsOutOfRangeRetryParams() {
        OfflineFlowYamlSupport support = new OfflineFlowYamlSupport();
        String base = support.buildEmptyFlowYaml("orders", "pg-1");

        assertThatThrownBy(() -> support.applySchedule(base, new OfflineFlowSchedule(
                "0 2 * * *", "Asia/Shanghai", true, OfflineSchedulePeriod.DAILY, true, 0, 5)))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getReason()).contains("1 到 5 次"));
        assertThatThrownBy(() -> support.applySchedule(base, new OfflineFlowSchedule(
                "0 2 * * *", "Asia/Shanghai", true, OfflineSchedulePeriod.DAILY, true, 6, 5)))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getReason()).contains("1 到 5 次"));
        assertThatThrownBy(() -> support.applySchedule(base, new OfflineFlowSchedule(
                "0 2 * * *", "Asia/Shanghai", true, OfflineSchedulePeriod.DAILY, true, 2, 0)))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getReason()).contains("1 到 60 分钟"));
        assertThatThrownBy(() -> support.applySchedule(base, new OfflineFlowSchedule(
                "0 2 * * *", "Asia/Shanghai", true, OfflineSchedulePeriod.DAILY, true, 2, 61)))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getReason()).contains("1 到 60 分钟"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void compileGraph_injectsRerunInputAndRunIf_andDebugAndInspectorHandleGraph() {
        OfflineFlowYamlSupport support = new OfflineFlowYamlSupport();
        String compiled = support.compileGraph(
                support.buildEmptyFlowYaml("orders", "pg-1"),
                List.of(
                        new OfflineFlowNode("extract", "SHELL", "scripts/extract.sh", null, null, null),
                        new OfflineFlowNode("extract_extra", "SHELL", "scripts/extract_extra.sh", null, null, null)
                ),
                List.of(new OfflineFlowYamlSupport.FlowEdge("extract", "extract_extra")),
                Map.of()
        );

        Map<String, Object> root = new Yaml().load(compiled);
        assertThat((List<Map<String, Object>>) root.get("inputs"))
                .extracting(input -> input.get("id"))
                .containsExactly("wbdata_rerun_tasks");
        Map<String, Object> dag = ((List<Map<String, Object>>) root.get("tasks")).getFirst();
        List<Map<String, Object>> dagTasks = (List<Map<String, Object>>) dag.get("tasks");
        assertThat((Map<String, Object>) dagTasks.get(0).get("task"))
                .containsEntry("runIf", OfflineFlowGraphYaml.buildRerunRunIfExpression("extract"));
        assertThat((Map<String, Object>) dagTasks.get(1).get("task"))
                .containsEntry("runIf", OfflineFlowGraphYaml.buildRerunRunIfExpression("extract_extra"));

        OfflineFlowInspector inspector = new OfflineFlowInspector();
        OfflineFlowInspector.InspectedGraph inspected = inspector.inspectGraph(compiled);
        assertThat(inspected.partialRerunSupported()).isTrue();
        assertThat(inspected.nodes()).extracting(OfflineFlowInspector.InspectedNode::taskId)
                .containsExactly("extract", "extract_extra");
        assertThat(inspected.edges()).containsExactly(
                new OfflineFlowInspector.InspectedEdge("extract", "extract_extra"));

        String debugFlow = support.buildDebugFlow(
                compiled,
                "wb-debug-g1-bmain-u1",
                "_flows/orders/flow.yaml",
                1L,
                1L,
                "main",
                "revision",
                "SELECTED",
                List.of("extract_extra")
        );
        Map<String, Object> debugRoot = new Yaml().load(debugFlow);
        assertThat(debugRoot).doesNotContainKey("inputs");
        Map<String, Object> debugDag = ((List<Map<String, Object>>) debugRoot.get("tasks")).getFirst();
        List<Map<String, Object>> debugDagTasks = (List<Map<String, Object>>) debugDag.get("tasks");
        assertThat((Map<String, Object>) debugDagTasks.get(0).get("task")).doesNotContainKey("runIf");
        assertThat((Map<String, Object>) debugDagTasks.get(1).get("task")).doesNotContainKey("runIf");

        String legacyYamlWithoutScript = """
                id: legacy_flow
                namespace: g1-main
                tasks:
                  - id: wb_upstream_gate
                    type: io.wbdata.kestra.core.WaitUpstream
                  - id: legacy_cmd
                    type: io.kestra.plugin.scripts.shell.Commands
                    commands:
                      - echo ok
                """;
        OfflineFlowInspector.InspectedGraph legacyGraph = inspector.inspectGraph(legacyYamlWithoutScript);
        assertThat(legacyGraph.partialRerunSupported()).isFalse();
        assertThat(legacyGraph.nodes()).containsExactly(
                new OfflineFlowInspector.InspectedNode("legacy_cmd", "SHELL", null));
    }

}
