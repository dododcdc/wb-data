package com.wbdata.offline.service;

import com.wbdata.datasource.entity.DataSource;
import com.wbdata.offline.config.OfflineTransferProperties;
import org.junit.jupiter.api.Test;
import org.yaml.snakeyaml.Yaml;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

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
    void compileAndParseGraph_roundTripsMysqlNodeKind() {
        OfflineFlowYamlSupport support = new OfflineFlowYamlSupport();
        DataSource mysql = new DataSource();
        mysql.setId(1L);
        mysql.setType("MYSQL");
        mysql.setHost("db.example");
        mysql.setPort(3306);
        mysql.setDatabaseName("warehouse");
        mysql.setUsername("analyst");
        mysql.setPassword("secret");

        String yaml = support.compileGraph(
                support.buildEmptyFlowYaml("orders", "pg-1"),
                List.of(new OfflineFlowNode(
                        "query", "MYSQL", "scripts/query.sql", 1L, "MYSQL", null
                )),
                List.of(),
                Map.of(1L, mysql)
        );

        assertThat(yaml).contains("nodeKind=MYSQL");
        OfflineFlowNode node = support.parseDocument(yaml)
                .stages().getFirst().nodes().getFirst();
        assertThat(node.kind()).isEqualTo("MYSQL");
    }

}
