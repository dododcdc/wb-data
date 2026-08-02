package com.wbdata.offline.service;

import com.wbdata.offline.config.OfflineTransferProperties;
import org.junit.jupiter.api.Test;
import org.yaml.snakeyaml.Yaml;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class OfflineFlowYamlSupportTest {

    @Test
    void compileAndParseGraph_roundTripsTransferMetadataAndNamespaceSidecar() {
        OfflineFlowYamlSupport support = new OfflineFlowYamlSupport();
        String transferPath = "transfers/orders/transfer_1.transfer.json";

        String yaml = support.compileGraph(
                support.buildEmptyFlowYaml("orders", "pg-1"),
                List.of(new OfflineFlowYamlSupport.FlowNode(
                        "transfer_1", "TRANSFER", null, null, null, transferPath
                )),
                List.of(),
                Map.of()
        );

        OfflineFlowYamlSupport.FlowNode node = support.parseDocument(yaml)
                .stages().getFirst().nodes().getFirst();

        assertThat(node.kind()).isEqualTo("TRANSFER");
        assertThat(node.scriptPath()).isNull();
        assertThat(node.transferConfigPath()).isEqualTo(transferPath);
        assertThat(support.collectNamespaceFiles(yaml)).containsExactly(transferPath);
    }

    @Test
    void compileGraph_generatesDockerBackedSeaTunnelTransferTask() {
        OfflineTransferProperties transferProperties = new OfflineTransferProperties();
        transferProperties.setSeatunnelImage("registry.example/seatunnel:custom");
        transferProperties.setDockerNetwork("transfer-network");
        transferProperties.setInternalBaseUrlEnv("TRANSFER_BACKEND_URL");
        transferProperties.setInternalTokenEnv("TRANSFER_BACKEND_TOKEN");
        transferProperties.setInternalBaseUrl("http://host.docker.internal:18080");
        transferProperties.setInternalToken("dev-transfer-token");
        transferProperties.setDockerVolumes(List.of("wb-data_hive-warehouse:/opt/hive/data/warehouse"));
        OfflineFlowYamlSupport support = new OfflineFlowYamlSupport(transferProperties);
        String transferPath = "transfers/orders/transfer_1.transfer.json";

        Map<String, Object> task = compiledTask(support, new OfflineFlowYamlSupport.FlowNode(
                "transfer_1", "TRANSFER", null, null, null, transferPath
        ), Map.of());

        assertThat(task).containsEntry("type", "io.kestra.plugin.scripts.shell.Commands");
        assertThat(task).containsEntry("containerImage", "registry.example/seatunnel:custom");
        assertThat(task).containsEntry("namespaceFiles", Map.of("enabled", true, "include", List.of(transferPath)));
        assertThat(task).containsEntry("description", "[wbdata-meta] nodeKind=TRANSFER;transferConfigPath=" + transferPath);
        assertThat(task).containsEntry("env", Map.of(
                "TRANSFER_BACKEND_URL", "http://host.docker.internal:18080",
                "TRANSFER_BACKEND_TOKEN", "dev-transfer-token"
        ));
        assertThat(task).containsEntry("taskRunner", Map.of(
                "type", "io.kestra.plugin.scripts.runner.docker.Docker",
                "networkMode", "transfer-network",
                "pullPolicy", "IF_NOT_PRESENT",
                "volumes", List.of("wb-data_hive-warehouse:/opt/hive/data/warehouse")
        ));
        assertThat((List<String>) task.get("commands")).containsExactly(
                "set -eu",
                "mkdir -p /tmp/wb-data-transfer",
                "curl --fail --show-error --silent -H \"X-WB-Data-Internal-Token: ${TRANSFER_BACKEND_TOKEN}\" "
                        + "-H 'Content-Type: application/json' --data-binary @'" + transferPath + "' "
                        + "\"${TRANSFER_BACKEND_URL}/api/v1/internal/offline/transfer/render\" "
                        + "-o /tmp/wb-data-transfer/transfer_1.conf",
                "/opt/seatunnel/bin/seatunnel.sh --config /tmp/wb-data-transfer/transfer_1.conf -m local"
        );
    }

    @Test
    void compileGraph_doesNotUseYamlAnchorsForTransferRunnerVolumes() {
        OfflineTransferProperties transferProperties = new OfflineTransferProperties();
        transferProperties.setDockerVolumes(List.of("wb-data_hive-warehouse:/opt/hive/data/warehouse"));
        OfflineFlowYamlSupport support = new OfflineFlowYamlSupport(transferProperties);

        String yaml = support.compileGraph(
                support.buildEmptyFlowYaml("orders", "pg-1"),
                List.of(
                        new OfflineFlowYamlSupport.FlowNode(
                                "transfer_1", "TRANSFER", null, null, null, "transfers/orders/transfer_1.transfer.json"
                        ),
                        new OfflineFlowYamlSupport.FlowNode(
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
    void compileGraph_omitsTransferRunnerVolumesWhenUnset() {
        OfflineFlowYamlSupport support = new OfflineFlowYamlSupport();

        Map<String, Object> task = compiledTask(support, new OfflineFlowYamlSupport.FlowNode(
                "transfer_1", "TRANSFER", null, null, null, "transfers/orders/transfer_1.transfer.json"
        ), Map.of());

        assertThat(task).containsEntry("containerImage", OfflineTransferProperties.DEFAULT_SEATUNNEL_IMAGE);
        Map<String, Object> taskRunner = (Map<String, Object>) task.get("taskRunner");
        assertThat(taskRunner).doesNotContainKey("volumes");
    }

    @Test
    void compileGraph_preservesSqlHiveSqlAndShellTaskFields() {
        OfflineFlowYamlSupport support = new OfflineFlowYamlSupport();
        com.wbdata.datasource.entity.DataSource mysql = dataSource(1L, "MYSQL");
        com.wbdata.datasource.entity.DataSource hive = dataSource(2L, "HIVE");

        Map<String, Object> sqlTask = compiledTask(support, new OfflineFlowYamlSupport.FlowNode(
                "sql_1", "SQL", "scripts/sql_1.sql", 1L, "MYSQL", null
        ), Map.of(1L, mysql));
        Map<String, Object> hiveTask = compiledTask(support, new OfflineFlowYamlSupport.FlowNode(
                "hive_1", "HIVE_SQL", "scripts/hive_1.hql", 2L, "HIVE", null
        ), Map.of(2L, hive));
        Map<String, Object> shellTask = compiledTask(support, new OfflineFlowYamlSupport.FlowNode(
                "shell_1", "SHELL", "scripts/shell_1.sh", null, null, null
        ), Map.of());

        assertThat(sqlTask).containsExactlyInAnyOrderEntriesOf(Map.of(
                "id", "sql_1",
                "type", "io.kestra.plugin.jdbc.mysql.Query",
                "description", "[wbdata-meta] dataSourceId=1;dataSourceType=MYSQL;nodeKind=SQL",
                "url", "jdbc:mysql://db.example:3306/warehouse",
                "username", "analyst",
                "password", "existing-password",
                "sql", "{{ read('scripts/sql_1.sql') }}"
        ));
        assertThat(hiveTask).containsExactlyInAnyOrderEntriesOf(Map.of(
                "id", "hive_1",
                "type", "io.kestra.plugin.scripts.shell.Commands",
                "description", "[wbdata-meta] dataSourceId=2;dataSourceType=HIVE;nodeKind=HIVE_SQL",
                "namespaceFiles", Map.of("enabled", true, "include", List.of("scripts/hive_1.hql")),
                "commands", List.of("beeline -u 'jdbc:hive2://db.example:3306/warehouse' -n 'analyst' -p 'existing-password' -f 'scripts/hive_1.hql'")
        ));
        assertThat(shellTask).containsExactlyInAnyOrderEntriesOf(Map.of(
                "id", "shell_1",
                "type", "io.kestra.plugin.scripts.shell.Commands",
                "namespaceFiles", Map.of("enabled", true, "include", List.of("scripts/shell_1.sh")),
                "commands", List.of("bash 'scripts/shell_1.sh'")
        ));
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> compiledTask(OfflineFlowYamlSupport support,
                                             OfflineFlowYamlSupport.FlowNode node,
                                             Map<Long, com.wbdata.datasource.entity.DataSource> dataSources) {
        String yaml = support.compileGraph(
                support.buildEmptyFlowYaml("orders", "pg-1"),
                List.of(node),
                List.of(),
                dataSources
        );
        Map<String, Object> root = new Yaml().load(yaml);
        Map<String, Object> dag = ((List<Map<String, Object>>) root.get("tasks")).getFirst();
        Map<String, Object> dagTask = ((List<Map<String, Object>>) dag.get("tasks")).getFirst();
        return (Map<String, Object>) dagTask.get("task");
    }

    private com.wbdata.datasource.entity.DataSource dataSource(Long id, String type) {
        com.wbdata.datasource.entity.DataSource dataSource = new com.wbdata.datasource.entity.DataSource();
        dataSource.setId(id);
        dataSource.setType(type);
        dataSource.setHost("db.example");
        dataSource.setPort(3306);
        dataSource.setDatabaseName("warehouse");
        dataSource.setUsername("analyst");
        dataSource.setPassword("existing-password");
        return dataSource;
    }
}
