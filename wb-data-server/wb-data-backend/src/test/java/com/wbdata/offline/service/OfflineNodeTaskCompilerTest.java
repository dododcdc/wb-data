package com.wbdata.offline.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wbdata.datasource.entity.DataSource;
import com.wbdata.offline.config.OfflineTransferProperties;
import com.wbdata.offline.config.TransferRunner;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

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
                "TRANSFER_BACKEND_TOKEN", "{{ secret('TRANSFER_BACKEND_TOKEN') }}"
        ));
        assertThat(task.toString()).doesNotContain("dev-transfer-token");
        assertThat(task).containsEntry("taskRunner", Map.of(
                "type", "io.kestra.plugin.scripts.runner.docker.Docker",
                "networkMode", "transfer-network",
                "pullPolicy", "IF_NOT_PRESENT",
                "volumes", List.of("wb-data_hive-warehouse:/opt/hive/data/warehouse")
        ));
        assertThat(task).containsEntry("inputFiles", Map.of("wb-data-transfer-parameters.json", "{}"));
        assertThat((List<String>) task.get("commands")).containsExactly(
                "set -eu",
                "mkdir -p /tmp/wb-data-transfer",
                requestAssemblyCommand("transfer_1", transferPath),
                "curl --fail --show-error --silent -H \"X-WB-Data-Internal-Token: ${TRANSFER_BACKEND_TOKEN}\" "
                        + "-H 'Content-Type: application/json' --data-binary @'/tmp/wb-data-transfer/transfer_1-request.json' "
                        + "\"${TRANSFER_BACKEND_URL}/api/v1/internal/offline/transfer/render\" "
                        + "-o /tmp/wb-data-transfer/transfer_1.conf",
                sqlPhaseCommand("pre-sql", "/tmp/wb-data-transfer/transfer_1-request.json"),
                "/opt/seatunnel/bin/seatunnel.sh --config /tmp/wb-data-transfer/transfer_1.conf -m local",
                sqlPhaseCommand("post-sql", "/tmp/wb-data-transfer/transfer_1-request.json")
        );
    }

    @Test
    void compile_generatesProcessBackedSeaTunnelTransferTaskWithoutDockerRunner() {
        OfflineTransferProperties transferProperties = new OfflineTransferProperties();
        transferProperties.setRunner(TransferRunner.PROCESS);
        transferProperties.setSeatunnelHome("/usr/local/seatunnel");
        transferProperties.setInternalBaseUrlEnv("TRANSFER_BACKEND_URL");
        transferProperties.setInternalTokenEnv("TRANSFER_BACKEND_TOKEN");
        transferProperties.setInternalBaseUrl("http://wb-data-backend:8080");
        transferProperties.setInternalToken("prod-transfer-token");
        transferProperties.setDockerNetwork("should-not-appear");
        transferProperties.setDockerVolumes(List.of("should-not-appear:/unused"));
        OfflineNodeTaskCompiler compiler = new OfflineNodeTaskCompiler(transferProperties);
        String transferPath = "transfers/orders/transfer_1.transfer.json";

        Map<String, Object> task = compiler.compile(null, new OfflineFlowNode(
                "transfer_1", "TRANSFER", null, null, null, transferPath
        ), Map.of());

        assertThat(task).containsEntry("type", "io.kestra.plugin.scripts.shell.Commands");
        assertThat(task).doesNotContainKey("containerImage");
        assertThat(task).doesNotContainKey("taskRunner");
        assertThat(task).containsEntry("env", Map.of(
                "TRANSFER_BACKEND_URL", "http://wb-data-backend:8080",
                "TRANSFER_BACKEND_TOKEN", "{{ secret('TRANSFER_BACKEND_TOKEN') }}"
        ));
        assertThat(task.toString()).doesNotContain("prod-transfer-token");
        assertThat(task).containsEntry("inputFiles", Map.of("wb-data-transfer-parameters.json", "{}"));
        assertThat((List<String>) task.get("commands")).containsExactly(
                "set -eu",
                "mkdir -p /tmp/wb-data-transfer",
                requestAssemblyCommand("transfer_1", transferPath),
                "curl --fail --show-error --silent -H \"X-WB-Data-Internal-Token: ${TRANSFER_BACKEND_TOKEN}\" "
                        + "-H 'Content-Type: application/json' --data-binary @'/tmp/wb-data-transfer/transfer_1-request.json' "
                        + "\"${TRANSFER_BACKEND_URL}/api/v1/internal/offline/transfer/render\" "
                        + "-o /tmp/wb-data-transfer/transfer_1.conf",
                sqlPhaseCommand("pre-sql", "/tmp/wb-data-transfer/transfer_1-request.json"),
                "/usr/local/seatunnel/bin/seatunnel.sh --config /tmp/wb-data-transfer/transfer_1.conf -m local",
                sqlPhaseCommand("post-sql", "/tmp/wb-data-transfer/transfer_1-request.json")
        );
    }

    @Test
    void transferParametersAreStoredOnlyInInputFileAndClearedWhenNoLongerReferenced() {
        OfflineNodeTaskCompiler compiler = new OfflineNodeTaskCompiler();
        OfflineFlowNode node = new OfflineFlowNode("transfer_1", "TRANSFER", null, null, null, "transfer.json");
        String expression = "{{ {\"name\": inputs.name} | toJson }}";
        Map<String, Object> task = compiler.compile(null, node, Map.of(), expression, true);

        assertThat(task).containsEntry("inputFiles", Map.of("wb-data-transfer-parameters.json", expression));
        assertThat(String.join("\n", (List<String>) task.get("commands"))).doesNotContain(expression, "inputs.name");
        Map<String, Object> unbound = compiler.compile(task, node, Map.of(), null, true);
        assertThat(unbound).containsEntry("inputFiles", Map.of("wb-data-transfer-parameters.json", "{}"));
        assertThat(task).containsEntry("inputFiles", Map.of("wb-data-transfer-parameters.json", expression));
    }

    @Test
    void compile_generatesScriptRenderCommandsUsingSecretTokenAndCurlFail() {
        OfflineTransferProperties transferProperties = new OfflineTransferProperties();
        transferProperties.setInternalBaseUrl("http://wb-data-backend:8080");
        transferProperties.setInternalToken("test-token");
        transferProperties.setInternalBaseUrlEnv("INTERNAL_BASE_URL");
        transferProperties.setInternalTokenEnv("INTERNAL_TOKEN");
        OfflineNodeTaskCompiler compiler = new OfflineNodeTaskCompiler(transferProperties);
        OfflineFlowNode node = new OfflineFlowNode("shell_1", "SHELL", "scripts/task_1.sh", null, null, null);
        String expression = "{{ {\"day\": inputs.day} | toJson }}";

        Map<String, Object> task = compiler.compile(null, node, Map.of(), expression, true);

        assertThat(task).containsEntry("env", Map.of(
                "INTERNAL_BASE_URL", "http://wb-data-backend:8080",
                "INTERNAL_TOKEN", "{{ secret('INTERNAL_TOKEN') }}"
        ));
        assertThat(task.toString()).doesNotContain("test-token");
        assertThat(task).containsEntry("inputFiles", Map.of("wb-data-script-parameters.json", expression));
        assertThat((List<String>) task.get("commands")).containsExactly(
                "set -eu",
                "mkdir -p /tmp/wb-data-script",
                "{ printf '%s' '{\"kind\":\"SHELL\",\"script\":\"'; base64 -w 0 'scripts/task_1.sh'; printf '%s' '\",\"parameters\":'; cat 'wb-data-script-parameters.json'; printf '%s' '}'; } > '/tmp/wb-data-script/shell_1-request.json'",
                "curl --fail --show-error --silent -H \"X-WB-Data-Internal-Token: ${INTERNAL_TOKEN}\" -H 'Content-Type: application/json' --data-binary @'/tmp/wb-data-script/shell_1-request.json' \"${INTERNAL_BASE_URL}/api/v1/internal/offline/script/render\" -o '/tmp/wb-data-script/shell_1.sh'",
                "bash '/tmp/wb-data-script/shell_1.sh'"
        );
    }

    private String requestAssemblyCommand(String taskId, String transferPath) {
        return "{ printf '%s' '{\"config\":'; cat '" + transferPath
                + "'; printf '%s' ',\"parameters\":'; cat 'wb-data-transfer-parameters.json'; printf '%s' '}'; } "
                + "> '/tmp/wb-data-transfer/" + taskId + "-request.json'";
    }

    private String sqlPhaseCommand(String phase, String requestPath) {
        return "curl --fail --show-error --silent -H \"X-WB-Data-Internal-Token: ${TRANSFER_BACKEND_TOKEN}\" "
                + "-H 'Content-Type: application/json' --data-binary @'" + requestPath + "' "
                + "\"${TRANSFER_BACKEND_URL}/api/v1/internal/offline/transfer/" + phase + "\"";
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"none", "render", "pre", "transfer", "post", "missing-config", "missing-parameters"})
    void transferScriptStopsAtFirstFailedPhase(String failedPhase, @org.junit.jupiter.api.io.TempDir java.nio.file.Path tempDir) throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        String value = "O'Reilly\n$(touch injected) ${TRANSFER_BACKEND_TOKEN} 中文 \"},\"config\":{} \\ %s";
        Map<String, String> config = Map.of("note", value);
        Map<String, String> parameters = Map.of("value", value, "other", "^[value]");
        if (!"missing-config".equals(failedPhase)) {
            java.nio.file.Files.writeString(tempDir.resolve("transfer.json"), mapper.writeValueAsString(config));
        }
        if (!"missing-parameters".equals(failedPhase)) {
            java.nio.file.Files.writeString(tempDir.resolve("wb-data-transfer-parameters.json"), mapper.writeValueAsString(parameters));
        }
        java.nio.file.Path bin = java.nio.file.Files.createDirectories(tempDir.resolve("bin"));
        java.nio.file.Path trace = tempDir.resolve("trace");
        java.nio.file.Path curl = bin.resolve("curl");
        java.nio.file.Files.writeString(curl, """
                #!/bin/sh
                set -eu
                case "$*" in
                  *pre-sql*) phase=pre ;;
                  *post-sql*) phase=post ;;
                  *) phase=render ;;
                esac
                for argument in "$@"; do
                  case "$argument" in
                    @*) cp "${argument#@}" "$TRACE.$phase.json" ;;
                  esac
                done
                echo "$phase" >> "$TRACE"
                test "$phase" != "$FAIL_STAGE"
                """);
        java.nio.file.Path seatunnel = bin.resolve("seatunnel.sh");
        java.nio.file.Files.writeString(seatunnel, """
                #!/bin/sh
                echo transfer >> "$TRACE"
                test transfer != "$FAIL_STAGE"
                """);
        assertThat(curl.toFile().setExecutable(true)).isTrue();
        assertThat(seatunnel.toFile().setExecutable(true)).isTrue();
        OfflineTransferProperties properties = new OfflineTransferProperties();
        properties.setRunner(TransferRunner.PROCESS);
        properties.setSeatunnelHome(tempDir.toString());
        properties.setInternalBaseUrlEnv("TRANSFER_BACKEND_URL");
        properties.setInternalTokenEnv("TRANSFER_BACKEND_TOKEN");
        Map<String, Object> task = new OfflineNodeTaskCompiler(properties).compile(null,
                new OfflineFlowNode("transfer_1", "TRANSFER", null, null, null, "transfer.json"), Map.of());
        String script = String.join("\n", (List<String>) task.get("commands"))
                .replace("/tmp/wb-data-transfer", tempDir.resolve("rendered").toString());
        ProcessBuilder builder = new ProcessBuilder("/bin/sh", "-c", script)
                .directory(tempDir.toFile()).redirectErrorStream(true);
        builder.environment().put("PATH", bin + ":" + System.getenv("PATH"));
        builder.environment().put("TRACE", trace.toString());
        builder.environment().put("FAIL_STAGE", failedPhase);
        builder.environment().put("TRANSFER_BACKEND_URL", "http://unused.invalid");
        builder.environment().put("TRANSFER_BACKEND_TOKEN", "test-token");
        Process process = builder.start();
        assertThat(process.waitFor(10, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
        assertThat(process.exitValue()).isEqualTo("none".equals(failedPhase) ? 0 : 1);
        assertThat(tempDir.resolve("injected")).doesNotExist();
        List<String> phases = List.of("render", "pre", "transfer", "post");
        if (failedPhase.startsWith("missing-")) {
            assertThat(trace).doesNotExist();
        } else {
            int expectedSize = "none".equals(failedPhase) ? phases.size() : phases.indexOf(failedPhase) + 1;
            List<String> executed = phases.subList(0, expectedSize);
            assertThat(java.nio.file.Files.readAllLines(trace)).isEqualTo(executed);
            var expected = mapper.valueToTree(Map.of("config", config, "parameters", parameters));
            for (String phase : List.of("render", "pre", "post")) {
                java.nio.file.Path body = tempDir.resolve("trace." + phase + ".json");
                if (executed.contains(phase)) {
                    assertThat(mapper.readTree(java.nio.file.Files.readString(body))).isEqualTo(expected);
                    assertThat(java.nio.file.Files.readString(body))
                            .isEqualTo(java.nio.file.Files.readString(tempDir.resolve("rendered").resolve("transfer_1-request.json")));
                } else {
                    assertThat(body).doesNotExist();
                }
            }
        }
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
    void compile_emitsCredentialFreeSqlHiveSqlAndShellTasks() {
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
                "description", "[wbdata-meta] dataSourceId=1;dataSourceType=MYSQL;nodeKind=MYSQL",
                "dataSourceId", 1L,
                "groupId", 4L,
                "internalToken", "{{ secret('WB_DATA_INTERNAL_TOKEN') }}",
                "sql", "{{ read('scripts/sql_1.sql') }}"
        ));
        assertThat(sqlTask).doesNotContainKeys("url", "username", "password", "internalBaseUrl");
        assertThat(sqlTask.toString()).doesNotContain("existing-password", "analyst", "db.example");

        assertThat(hiveTask).containsExactlyInAnyOrderEntriesOf(Map.of(
                "id", "hive_1",
                "type", "io.wbdata.kestra.hive.Query",
                "description", "[wbdata-meta] dataSourceId=2;dataSourceType=HIVE;nodeKind=HIVE_SQL",
                "dataSourceId", 2L,
                "groupId", 4L,
                "internalToken", "{{ secret('WB_DATA_INTERNAL_TOKEN') }}",
                "namespaceFiles", Map.of("enabled", true, "include", List.of("scripts/hive_1.hql")),
                "scriptPath", "scripts/hive_1.hql",
                "containerImage", OfflineTransferProperties.DEFAULT_HIVE_SQL_IMAGE,
                "taskRunner", Map.of(
                        "type", "io.kestra.plugin.scripts.runner.docker.Docker",
                        "networkMode", "wb-data_default",
                        "pullPolicy", "IF_NOT_PRESENT"
                )
        ));
        assertThat(hiveTask).doesNotContainKeys("commands", "url", "username", "password", "env");
        assertThat(hiveTask.toString()).doesNotContain("existing-password", "-p", "beeline", "db.example");

        assertThat(shellTask).containsExactlyInAnyOrderEntriesOf(Map.of(
                "id", "shell_1",
                "type", "io.kestra.plugin.scripts.shell.Commands",
                "namespaceFiles", Map.of("enabled", true, "include", List.of("scripts/shell_1.sh")),
                "commands", List.of("bash 'scripts/shell_1.sh'")
        ));
    }

    @Test
    void compile_rendersHiveParametersInlineAndShellParametersViaScriptRender() {
        OfflineNodeTaskCompiler compiler = new OfflineNodeTaskCompiler();
        String expression = "{{ {\"DWD\": inputs.DWD} | toJson }}";
        DataSource hive = dataSource(2L, "HIVE");
        OfflineFlowNode hiveNode = new OfflineFlowNode(
                "hive_1", "HIVE_SQL", "scripts/hive_1.hql", 2L, "HIVE", null);

        Map<String, Object> hiveTask = compiler.compile(null, hiveNode, Map.of(2L, hive), expression, true);

        assertThat(hiveTask).containsEntry("type", "io.wbdata.kestra.hive.Query");
        assertThat(hiveTask).containsEntry("parameters", expression);
        assertThat(hiveTask).containsEntry("scriptPath", "scripts/hive_1.hql");
        assertThat(hiveTask).containsKey("taskRunner");
        assertThat(hiveTask).doesNotContainKeys("inputFiles", "commands", "env");

        Map<String, Object> shellTask = compiler.compile(null, new OfflineFlowNode(
                "shell_1", "SHELL", "scripts/shell_1.sh", null, null, null
        ), Map.of(), expression, true);
        String shellCommands = String.join("\n", (List<String>) shellTask.get("commands"));
        assertThat(shellCommands).contains(
                "base64 -w 0 'scripts/shell_1.sh'",
                "bash '/tmp/wb-data-script/shell_1.sh'");
        assertThat(shellTask).doesNotContainKey("containerImage");

        Map<String, Object> cleared = compiler.compile(hiveTask, hiveNode, Map.of(2L, hive), null, true);
        assertThat(cleared).doesNotContainKeys("parameters", "inputFiles", "commands");
        assertThat(cleared).containsEntry("scriptPath", "scripts/hive_1.hql");
    }

    @Test
    void compile_stripsLegacyCredentialsWhenRecompilingOrSwitchingTaskKindsWithoutMutatingSource() {
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

        DataSource mysql = dataSource(1L, "MYSQL");
        Map<String, Object> recompiledSql = compiler.compile(existingTask, new OfflineFlowNode(
                "task_1", "MYSQL", "scripts/task_1.sql", 1L, "MYSQL", null
        ), Map.of(1L, mysql));
        assertThat(recompiledSql).doesNotContainKeys("url", "username", "password", "disabled");
        assertThat(recompiledSql).containsEntry("description", "用户说明\n[wbdata-meta] dataSourceId=1;dataSourceType=MYSQL;nodeKind=MYSQL");
        assertThat(recompiledSql).containsEntry("dataSourceId", 1L);

        Map<String, Object> shellTask = compiler.compile(existingTask, new OfflineFlowNode(
                "task_1", "SHELL", "scripts/task_1.sh", null, null, null
        ), Map.of());

        assertThat(shellTask).containsExactlyInAnyOrderEntriesOf(Map.of(
                "id", "task_1",
                "type", "io.kestra.plugin.scripts.shell.Commands",
                "description", "用户说明",
                "namespaceFiles", Map.of("enabled", true, "include", List.of("scripts/task_1.sh")),
                "commands", List.of("bash 'scripts/task_1.sh'")
        ));
        assertThat(existingTask).containsKeys("disabled", "url", "username", "password", "sql");
    }

    @Test
    void compile_wiresInternalBaseUrlAndProcessRunnerForSqlAndHiveWhenConfigured() {
        OfflineTransferProperties transferProperties = new OfflineTransferProperties();
        transferProperties.setRunner(TransferRunner.PROCESS);
        transferProperties.setInternalBaseUrl("http://backend.internal:8080");
        transferProperties.setInternalTokenEnv("CUSTOM_INTERNAL_TOKEN");
        OfflineNodeTaskCompiler compiler = new OfflineNodeTaskCompiler(transferProperties);
        DataSource mysql = dataSource(1L, "MYSQL");
        mysql.setHost("localhost");
        DataSource hive = dataSource(2L, "HIVE");

        Map<String, Object> sqlTask = compiler.compile(null, new OfflineFlowNode(
                "sql_1", "SQL", "scripts/sql_1.sql", 1L, "MYSQL", null
        ), Map.of(1L, mysql));
        assertThat(sqlTask).containsEntry("internalBaseUrl", "http://backend.internal:8080");
        assertThat(sqlTask).containsEntry("internalToken", "{{ secret('CUSTOM_INTERNAL_TOKEN') }}");
        assertThat(sqlTask).doesNotContainKeys("url", "username", "password");

        Map<String, Object> hiveTask = compiler.compile(null, new OfflineFlowNode(
                "hive_1", "HIVE_SQL", "scripts/hive_1.hql", 2L, "HIVE", null
        ), Map.of(2L, hive));
        assertThat(hiveTask).containsEntry("internalBaseUrl", "http://backend.internal:8080");
        assertThat(hiveTask).containsEntry("internalToken", "{{ secret('CUSTOM_INTERNAL_TOKEN') }}");
        assertThat(hiveTask).doesNotContainKeys("containerImage", "taskRunner");
    }

    @Test
    void compile_writesJdbcKindMetadataAndRejectsMismatchedDataSource() {
        OfflineNodeTaskCompiler compiler = new OfflineNodeTaskCompiler();
        DataSource mysql = dataSource(1L, "MYSQL");
        DataSource postgres = dataSource(2L, "POSTGRESQL");
        postgres.setPort(5432);

        Map<String, Object> mysqlTask = compiler.compile(null, new OfflineFlowNode(
                "mysql_1", "MYSQL", "scripts/mysql_1.sql", 1L, "MYSQL", null
        ), Map.of(1L, mysql));
        Map<String, Object> postgresTask = compiler.compile(null, new OfflineFlowNode(
                "pg_1", "POSTGRESQL", "scripts/pg_1.sql", 2L, "POSTGRESQL", null
        ), Map.of(2L, postgres));

        assertThat(mysqlTask).containsEntry("type", "io.wbdata.kestra.jdbc.mysql.Query");
        assertThat(mysqlTask).containsEntry("description",
                "[wbdata-meta] dataSourceId=1;dataSourceType=MYSQL;nodeKind=MYSQL");
        assertThat(postgresTask).containsEntry("type", "io.wbdata.kestra.jdbc.postgresql.Query");
        assertThat(postgresTask).containsEntry("description",
                "[wbdata-meta] dataSourceId=2;dataSourceType=POSTGRESQL;nodeKind=POSTGRESQL");

        assertThatThrownBy(() -> compiler.compile(null, new OfflineFlowNode(
                "mysql_1", "MYSQL", "scripts/mysql_1.sql", 2L, "POSTGRESQL", null
        ), Map.of(2L, postgres)))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("只能绑定 MYSQL 数据源");
    }

    @Test
    void compile_storesNormalizedHiveConfMapAndPreservesWhenParametersRendered() {
        OfflineNodeTaskCompiler compiler = new OfflineNodeTaskCompiler();
        DataSource hive = dataSource(2L, "HIVE");
        hive.setPort(10000);
        Map<String, String> hiveConf = new LinkedHashMap<>();
        hiveConf.put("hive.exec.dynamic.partition.mode", "nonstrict");
        hiveConf.put("mapred.job.name", "daily's job; part=1");

        OfflineFlowNode node = new OfflineFlowNode(
                "hive_1", "HIVE_SQL", "scripts/hive_1.sql", 2L, "HIVE", null, hiveConf);

        Map<String, Object> plain = compiler.compile(null, node, Map.of(2L, hive));
        assertThat(plain).containsEntry("type", "io.wbdata.kestra.hive.Query");
        assertThat(plain).containsEntry("hiveConf", hiveConf);
        assertThat(plain).containsEntry("scriptPath", "scripts/hive_1.sql");
        assertThat(plain).doesNotContainKeys("commands", "password");

        Map<String, Object> parameterized = compiler.compile(null, node, Map.of(2L, hive), "{\"v_day\":\"20261114\"}", true);
        assertThat(parameterized).containsEntry("type", "io.wbdata.kestra.hive.Query");
        assertThat(parameterized).containsEntry("hiveConf", hiveConf);
        assertThat(parameterized).containsEntry("parameters", "{\"v_day\":\"20261114\"}");
        assertThat(parameterized).containsEntry("scriptPath", "scripts/hive_1.sql");
    }

    private DataSource dataSource(Long id, String type) {
        DataSource dataSource = new DataSource();
        dataSource.setId(id);
        dataSource.setGroupId(4L);
        dataSource.setType(type);
        dataSource.setHost("db.example");
        dataSource.setPort(3306);
        dataSource.setDatabaseName("warehouse");
        dataSource.setUsername("analyst");
        dataSource.setPassword("existing-password");
        return dataSource;
    }
}
