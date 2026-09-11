package com.wbdata.offline.service;

import com.wbdata.datasource.entity.DataSource;
import com.wbdata.offline.config.OfflineTransferProperties;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

@SuppressWarnings("unchecked")
class OfflineNodeTaskCompilerTest {

    @Test
    void compile_generatesDockerBackedSeaTunnelTransferTask() {
        OfflineTransferProperties transferProperties = new OfflineTransferProperties();
        transferProperties.setSeatunnelImage("registry.example/seatunnel:custom");
        transferProperties.setDockerNetwork("transfer-network");
        transferProperties.setInternalBaseUrlEnv("TRANSFER_BACKEND_URL");
        transferProperties.setInternalTokenEnv("TRANSFER_BACKEND_TOKEN");
        transferProperties.setInternalBaseUrl("http://host.docker.internal:18080");
        transferProperties.setInternalToken("dev-transfer-token");
        transferProperties.setDockerVolumes(List.of("wb-data_hive-warehouse:/opt/hive/data/warehouse"));
        OfflineNodeTaskCompiler compiler = new OfflineNodeTaskCompiler(transferProperties);
        String transferPath = "transfers/orders/transfer_1.transfer.json";

        Map<String, Object> task = compiler.compile(null, new OfflineFlowNode(
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
    void compile_omitsTransferRunnerVolumesWhenUnset() {
        OfflineNodeTaskCompiler compiler = new OfflineNodeTaskCompiler();

        Map<String, Object> task = compiler.compile(null, new OfflineFlowNode(
                "transfer_1", "TRANSFER", null, null, null, "transfers/orders/transfer_1.transfer.json"
        ), Map.of());

        assertThat(task).containsEntry("containerImage", OfflineTransferProperties.DEFAULT_SEATUNNEL_IMAGE);
        Map<String, Object> taskRunner = (Map<String, Object>) task.get("taskRunner");
        assertThat(taskRunner).doesNotContainKey("volumes");
    }

    @Test
    void compile_preservesSqlHiveSqlAndShellTaskFields() {
        OfflineNodeTaskCompiler compiler = new OfflineNodeTaskCompiler();
        DataSource mysql = dataSource(1L, "MYSQL");
        DataSource hive = dataSource(2L, "HIVE");

        Map<String, Object> sqlTask = compiler.compile(null, new OfflineFlowNode(
                "sql_1", "SQL", "scripts/sql_1.sql", 1L, "MYSQL", null
        ), Map.of(1L, mysql));
        Map<String, Object> hiveTask = compiler.compile(null, new OfflineFlowNode(
                "hive_1", "HIVE_SQL", "scripts/hive_1.hql", 2L, "HIVE", null
        ), Map.of(2L, hive));
        Map<String, Object> shellTask = compiler.compile(null, new OfflineFlowNode(
                "shell_1", "SHELL", "scripts/shell_1.sh", null, null, null
        ), Map.of());

        assertThat(sqlTask).containsExactlyInAnyOrderEntriesOf(Map.of(
                "id", "sql_1",
                "type", "io.wbdata.kestra.jdbc.mysql.Query",
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

    @Test
    void compile_rewritesExistingTaskWithoutMutatingSource() {
        OfflineNodeTaskCompiler compiler = new OfflineNodeTaskCompiler();
        Map<String, Object> existingTask = new LinkedHashMap<>();
        existingTask.put("id", "task_1");
        existingTask.put("type", "io.kestra.plugin.jdbc.mysql.Query");
        existingTask.put("description", "用户说明\n[wbdata-meta] dataSourceId=1;dataSourceType=MYSQL;nodeKind=SQL");
        existingTask.put("url", "jdbc:mysql://old-host:3306/old_db");
        existingTask.put("username", "old-user");
        existingTask.put("password", "old-password");
        existingTask.put("sql", "select 1");
        existingTask.put("disabled", true);

        Map<String, Object> task = compiler.compile(existingTask, new OfflineFlowNode(
                "task_1", "SHELL", "scripts/task_1.sh", null, null, null
        ), Map.of());

        assertThat(task).containsExactlyInAnyOrderEntriesOf(Map.of(
                "id", "task_1",
                "type", "io.kestra.plugin.scripts.shell.Commands",
                "description", "用户说明",
                "namespaceFiles", Map.of("enabled", true, "include", List.of("scripts/task_1.sh")),
                "commands", List.of("bash 'scripts/task_1.sh'")
        ));
        assertThat(existingTask).containsKeys("disabled", "url", "username", "password", "sql");
    }

    private DataSource dataSource(Long id, String type) {
        DataSource dataSource = new DataSource();
        dataSource.setId(id);
        dataSource.setType(type);
        dataSource.setHost("db.example");
        dataSource.setPort(3306);
        dataSource.setDatabaseName("warehouse");
        dataSource.setUsername("analyst");
        dataSource.setPassword("existing-password");
        return dataSource;
    }

    @Test
    void compile_rewritesLoopbackHostInSqlTaskUrlWhenConfigured() {
        OfflineTransferProperties transferProperties = new OfflineTransferProperties();
        transferProperties.setContainerHostRewrite("host.docker.internal");
        OfflineNodeTaskCompiler compiler = new OfflineNodeTaskCompiler(transferProperties);
        DataSource mysql = dataSource(1L, "MYSQL");
        mysql.setHost("localhost");

        Map<String, Object> task = compiler.compile(null, new OfflineFlowNode(
                "sql_1", "SQL", "scripts/sql_1.sql", 1L, "MYSQL", null
        ), Map.of(1L, mysql));

        assertThat(task).containsEntry("url", "jdbc:mysql://host.docker.internal:3306/warehouse");
    }

    @Test
    void compile_keepsLoopbackHostInSqlTaskUrlByDefault() {
        OfflineNodeTaskCompiler compiler = new OfflineNodeTaskCompiler();
        DataSource mysql = dataSource(1L, "MYSQL");
        mysql.setHost("127.0.0.1");

        Map<String, Object> task = compiler.compile(null, new OfflineFlowNode(
                "sql_1", "SQL", "scripts/sql_1.sql", 1L, "MYSQL", null
        ), Map.of(1L, mysql));

        assertThat(task).containsEntry("url", "jdbc:mysql://127.0.0.1:3306/warehouse");
    }
}
