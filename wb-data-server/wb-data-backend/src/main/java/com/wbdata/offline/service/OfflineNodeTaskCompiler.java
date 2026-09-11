package com.wbdata.offline.service;

import com.wbdata.datasource.entity.DataSource;
import com.wbdata.offline.config.OfflineTransferProperties;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class OfflineNodeTaskCompiler {
    static final String SHELL_COMMANDS_TASK_TYPE = "io.kestra.plugin.scripts.shell.Commands";
    static final String WB_DATA_JDBC_TASK_PREFIX = "io.wbdata.kestra.jdbc.";
    static final String KESTRA_JDBC_TASK_PREFIX = "io.kestra.plugin.jdbc.";

    private final TransferRuntimeSettings transferRuntimeSettings;
    private final TaskAdapter sqlAdapter = new SqlTaskAdapter();
    private final TaskAdapter hiveSqlAdapter = new HiveSqlTaskAdapter();
    private final TaskAdapter shellAdapter = new ShellTaskAdapter();
    private final TaskAdapter transferAdapter = new TransferTaskAdapter();

    OfflineNodeTaskCompiler() {
        this(new TransferRuntimeSettings(
                OfflineTransferProperties.DEFAULT_SEATUNNEL_IMAGE,
                "wb-data_default",
                "WB_DATA_INTERNAL_BASE_URL",
                "WB_DATA_INTERNAL_TOKEN",
                null,
                null,
                List.of()
        ));
    }

    OfflineNodeTaskCompiler(OfflineTransferProperties transferProperties) {
        this(new TransferRuntimeSettings(
                transferProperties.getSeatunnelImage(),
                transferProperties.getDockerNetwork(),
                transferProperties.getInternalBaseUrlEnv(),
                transferProperties.getInternalTokenEnv(),
                transferProperties.getInternalBaseUrl(),
                transferProperties.getInternalToken(),
                transferProperties.getDockerVolumes()
        ));
    }

    private OfflineNodeTaskCompiler(TransferRuntimeSettings transferRuntimeSettings) {
        this.transferRuntimeSettings = transferRuntimeSettings;
    }

    Map<String, Object> compile(Map<String, Object> existingTask,
                                OfflineFlowNode node,
                                Map<Long, DataSource> dataSourceMap) {
        return compile(existingTask, node, dataSourceMap, null, false);
    }

    Map<String, Object> compile(Map<String, Object> existingTask,
                                OfflineFlowNode node,
                                Map<Long, DataSource> dataSourceMap,
                                String jdbcParametersExpression,
                                boolean manageParameters) {
        Map<String, Object> task = existingTask == null
                ? new LinkedHashMap<>()
                : new LinkedHashMap<>(existingTask);
        task.putIfAbsent("id", node.taskId());
        task.remove("disabled");
        adapterFor(node.kind()).compile(task, node, dataSourceMap);
        if (manageParameters && "SQL".equalsIgnoreCase(node.kind())
                && task.get("type") instanceof String type
                && isJdbcQueryTaskType(type)) {
            if (jdbcParametersExpression == null) {
                task.remove("parameters");
            } else {
                task.put("parameters", jdbcParametersExpression);
            }
        }
        return task;
    }

    static String resolveKestraQueryTaskType(String dataSourceType) {
        String normalizedType = dataSourceType == null ? "" : dataSourceType.trim().toUpperCase();
        return switch (normalizedType) {
            case "MYSQL", "STARROCKS" -> WB_DATA_JDBC_TASK_PREFIX + "mysql.Query";
            case "POSTGRESQL" -> WB_DATA_JDBC_TASK_PREFIX + "postgresql.Query";
            default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "暂不支持的数据源类型: " + dataSourceType);
        };
    }

    static boolean isJdbcQueryTaskType(String type) {
        return type != null && (type.startsWith(WB_DATA_JDBC_TASK_PREFIX)
                || type.startsWith(KESTRA_JDBC_TASK_PREFIX));
    }

    private TaskAdapter adapterFor(String kind) {
        if ("TRANSFER".equalsIgnoreCase(kind)) {
            return transferAdapter;
        }
        if ("SQL".equalsIgnoreCase(kind)) {
            return sqlAdapter;
        }
        if ("HIVE_SQL".equalsIgnoreCase(kind)) {
            return hiveSqlAdapter;
        }
        return shellAdapter;
    }

    private interface TaskAdapter {
        void compile(Map<String, Object> task,
                     OfflineFlowNode node,
                     Map<Long, DataSource> dataSourceMap);
    }

    private final class TransferTaskAdapter implements TaskAdapter {
        @Override
        public void compile(Map<String, Object> task,
                            OfflineFlowNode node,
                            Map<Long, DataSource> dataSourceMap) {
            clearJdbcTaskFields(task);
            clearShellTaskFields(task);
            task.put("type", SHELL_COMMANDS_TASK_TYPE);
            task.put("description", OfflineTaskMetadataCodec.mergeTransfer(
                    readOptionalString(task, "description"),
                    node.transferConfigPath()
            ));
            task.put("namespaceFiles", buildNamespaceFilesConfig(node.transferConfigPath()));
            task.put("containerImage", transferRuntimeSettings.seatunnelImage());
            Map<String, String> env = buildTransferEnv();
            if (!env.isEmpty()) {
                task.put("env", env);
            }
            task.put("taskRunner", buildTransferTaskRunner());
            task.put("commands", buildTransferCommands(node.taskId(), node.transferConfigPath()));
        }
    }

    private final class SqlTaskAdapter implements TaskAdapter {
        @Override
        public void compile(Map<String, Object> task,
                            OfflineFlowNode node,
                            Map<Long, DataSource> dataSourceMap) {
            Long dataSourceId = node.dataSourceId();
            DataSource dataSource = dataSourceId == null ? null : dataSourceMap.get(dataSourceId);
            if (dataSource == null) {
                clearJdbcTaskFields(task);
                task.put("type", SHELL_COMMANDS_TASK_TYPE);
                task.put("namespaceFiles", buildNamespaceFilesConfig(node.scriptPath()));
                task.put("commands", List.of("cat " + shellQuote(node.scriptPath()) + " # No data source selected"));
                return;
            }

            clearShellTaskFields(task);
            String type = dataSource.getType().toUpperCase();
            task.put("type", resolveKestraQueryTaskType(type));
            task.put("description", OfflineTaskMetadataCodec.mergeDataSource(
                    readOptionalString(task, "description"),
                    dataSource.getId(),
                    type,
                    "SQL"
            ));
            task.put("url", buildJdbcUrl(dataSource.getHost(), dataSource.getPort(), dataSource.getDatabaseName(), type));
            task.put("username", dataSource.getUsername());
            task.put("password", dataSource.getPassword());
            task.put("sql", String.format("{{ read('%s') }}", node.scriptPath()));
        }
    }

    private final class HiveSqlTaskAdapter implements TaskAdapter {
        @Override
        public void compile(Map<String, Object> task,
                            OfflineFlowNode node,
                            Map<Long, DataSource> dataSourceMap) {
            Long dataSourceId = node.dataSourceId();
            DataSource dataSource = dataSourceId == null ? null : dataSourceMap.get(dataSourceId);

            clearJdbcTaskFields(task);
            clearShellTaskFields(task);
            if (dataSource == null) {
                task.put("type", SHELL_COMMANDS_TASK_TYPE);
                task.put("namespaceFiles", buildNamespaceFilesConfig(node.scriptPath()));
                task.put("commands", List.of("cat " + shellQuote(node.scriptPath()) + " # No data source selected"));
                return;
            }

            String type = dataSource.getType() == null ? "" : dataSource.getType().trim().toUpperCase();
            if (!"HIVE".equals(type)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "HiveSQL 节点只能绑定 Hive 数据源: " + node.taskId());
            }

            task.put("type", SHELL_COMMANDS_TASK_TYPE);
            task.put("description", OfflineTaskMetadataCodec.mergeDataSource(
                    readOptionalString(task, "description"),
                    dataSource.getId(),
                    type,
                    "HIVE_SQL"
            ));
            task.put("namespaceFiles", buildNamespaceFilesConfig(node.scriptPath()));
            task.put("commands", List.of(buildBeelineCommand(dataSource, node.scriptPath())));
        }
    }

    private final class ShellTaskAdapter implements TaskAdapter {
        @Override
        public void compile(Map<String, Object> task,
                            OfflineFlowNode node,
                            Map<Long, DataSource> dataSourceMap) {
            clearJdbcTaskFields(task);
            clearShellTaskFields(task);
            task.put("type", SHELL_COMMANDS_TASK_TYPE);
            task.put("namespaceFiles", buildNamespaceFilesConfig(node.scriptPath()));
            task.put("commands", List.of("bash " + shellQuote(node.scriptPath())));
        }
    }

    private Map<String, String> buildTransferEnv() {
        Map<String, String> env = new LinkedHashMap<>();
        putIfPresent(env, transferRuntimeSettings.internalBaseUrlEnv(), transferRuntimeSettings.internalBaseUrl());
        putIfPresent(env, transferRuntimeSettings.internalTokenEnv(), transferRuntimeSettings.internalToken());
        return env;
    }

    private void putIfPresent(Map<String, String> env, String name, String value) {
        if (name != null && !name.isBlank() && value != null && !value.isBlank()) {
            env.put(name, value);
        }
    }

    private Map<String, Object> buildTransferTaskRunner() {
        Map<String, Object> taskRunner = new LinkedHashMap<>();
        taskRunner.put("type", "io.kestra.plugin.scripts.runner.docker.Docker");
        taskRunner.put("networkMode", transferRuntimeSettings.dockerNetwork());
        taskRunner.put("pullPolicy", "IF_NOT_PRESENT");
        List<String> dockerVolumes = transferRuntimeSettings.dockerVolumes() == null
                ? List.of()
                : transferRuntimeSettings.dockerVolumes().stream()
                .filter(volume -> volume != null && !volume.isBlank())
                .toList();
        if (!dockerVolumes.isEmpty()) {
            taskRunner.put("volumes", new ArrayList<>(dockerVolumes));
        }
        return taskRunner;
    }

    private List<String> buildTransferCommands(String taskId, String transferConfigPath) {
        String renderedConfigPath = "/tmp/wb-data-transfer/" + taskId + ".conf";
        return List.of(
                "set -eu",
                "mkdir -p /tmp/wb-data-transfer",
                "curl --fail --show-error --silent -H \"X-WB-Data-Internal-Token: ${"
                        + transferRuntimeSettings.internalTokenEnv() + "}\" -H 'Content-Type: application/json' "
                        + "--data-binary @" + shellQuote(transferConfigPath) + " \"${"
                        + transferRuntimeSettings.internalBaseUrlEnv() + "}/api/v1/internal/offline/transfer/render\" "
                        + "-o " + renderedConfigPath,
                "/opt/seatunnel/bin/seatunnel.sh --config " + renderedConfigPath + " -m local"
        );
    }

    private Map<String, Object> buildNamespaceFilesConfig(String scriptPath) {
        Map<String, Object> namespaceFiles = new LinkedHashMap<>();
        namespaceFiles.put("enabled", true);
        namespaceFiles.put("include", List.of(scriptPath));
        return namespaceFiles;
    }

    private String buildBeelineCommand(DataSource dataSource, String scriptPath) {
        StringBuilder command = new StringBuilder("beeline -u ")
                .append(shellQuote(buildJdbcUrl(
                        dataSource.getHost(),
                        dataSource.getPort(),
                        dataSource.getDatabaseName(),
                        "HIVE"
                )));
        if (dataSource.getUsername() != null && !dataSource.getUsername().isBlank()) {
            command.append(" -n ").append(shellQuote(dataSource.getUsername()));
        }
        if (dataSource.getPassword() != null && !dataSource.getPassword().isBlank()) {
            command.append(" -p ").append(shellQuote(dataSource.getPassword()));
        }
        command.append(" -f ").append(shellQuote(scriptPath));
        return command.toString();
    }

    private String buildJdbcUrl(String host, Integer port, String databaseName, String dataSourceType) {
        String normalizedType = dataSourceType == null ? "" : dataSourceType.trim().toUpperCase();
        String databaseSegment = databaseName == null || databaseName.isBlank() ? "" : "/" + databaseName;
        return switch (normalizedType) {
            case "MYSQL", "STARROCKS" -> String.format("jdbc:mysql://%s:%d%s", host, port, databaseSegment);
            case "POSTGRESQL" -> String.format("jdbc:postgresql://%s:%d%s", host, port, databaseSegment);
            case "HIVE" -> String.format("jdbc:hive2://%s:%d%s", host, port, databaseSegment);
            default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "暂不支持的数据源类型: " + dataSourceType);
        };
    }

    private String shellQuote(String value) {
        return "'" + (value == null ? "" : value.replace("'", "'\"'\"'")) + "'";
    }

    private void clearShellTaskFields(Map<String, Object> task) {
        task.remove("namespaceFiles");
        task.remove("commands");
        task.remove("containerImage");
        task.remove("taskRunner");
        task.remove("labels");
        OfflineTaskMetadataCodec.cleanup(task);
    }

    private void clearJdbcTaskFields(Map<String, Object> task) {
        task.remove("url");
        task.remove("username");
        task.remove("password");
        task.remove("sql");
        task.remove("driverClassName");
        task.remove("parameters");
        task.remove("fetch");
        task.remove("fetchOne");
        task.remove("fetchType");
        task.remove("fetchSize");
        task.remove("afterSQL");
        task.remove("timeZoneId");
        task.remove("store");
        task.remove("inputFile");
        task.remove("labels");
        OfflineTaskMetadataCodec.cleanup(task);
    }

    private String readOptionalString(Map<String, Object> source, String key) {
        Object value = source.get(key);
        return value instanceof String text && !text.isBlank() ? text : null;
    }

    private record TransferRuntimeSettings(
            String seatunnelImage,
            String dockerNetwork,
            String internalBaseUrlEnv,
            String internalTokenEnv,
            String internalBaseUrl,
            String internalToken,
            List<String> dockerVolumes
    ) {
    }
}
