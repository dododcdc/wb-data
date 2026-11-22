package com.wbdata.offline.service;

import com.wbdata.datasource.entity.DataSource;
import com.wbdata.offline.config.OfflineTransferProperties;
import com.wbdata.offline.config.TransferRunner;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

final class OfflineNodeTaskCompiler {
    static final String SHELL_COMMANDS_TASK_TYPE = "io.kestra.plugin.scripts.shell.Commands";
    static final String WB_DATA_JDBC_TASK_PREFIX = "io.wbdata.kestra.jdbc.";
    static final String KESTRA_JDBC_TASK_PREFIX = "io.kestra.plugin.jdbc.";
    static final String HIVE_QUERY_TASK_TYPE = "io.wbdata.kestra.hive.Query";

    private final TransferRuntimeSettings transferRuntimeSettings;
    private final TaskAdapter sqlAdapter = new SqlTaskAdapter();
    private final TaskAdapter hiveSqlAdapter = new HiveSqlTaskAdapter();
    private final TaskAdapter shellAdapter = new ShellTaskAdapter();
    private final TaskAdapter transferAdapter = new TransferTaskAdapter();

    OfflineNodeTaskCompiler() {
        this(new OfflineTransferProperties());
    }

    OfflineNodeTaskCompiler(OfflineTransferProperties transferProperties) {
        this(new TransferRuntimeSettings(
                transferProperties.getSeatunnelImage(),
                transferProperties.getDockerNetwork(),
                transferProperties.getInternalBaseUrlEnv(),
                transferProperties.getInternalTokenEnv(),
                transferProperties.getInternalBaseUrl(),
                transferProperties.getDockerVolumes(),
                transferProperties.getRunner(),
                transferProperties.getSeatunnelHome(),
                transferProperties.getHiveSqlImage()
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
                                String parametersExpression,
                                boolean manageParameters) {
        Map<String, Object> task = existingTask == null
                ? new LinkedHashMap<>()
                : new LinkedHashMap<>(existingTask);
        task.putIfAbsent("id", node.taskId());
        task.remove("disabled");
        adapterFor(node.kind()).compile(task, node, dataSourceMap);
        if ("TRANSFER".equalsIgnoreCase(node.kind())) {
            task.put("inputFiles", Map.of("wb-data-transfer-parameters.json",
                    parametersExpression == null ? "{}" : parametersExpression));
        }
        if (manageParameters && supportsInlineParameters(task)) {
            if (parametersExpression == null) {
                task.remove("parameters");
            } else {
                task.put("parameters", parametersExpression);
            }
        }
        if (manageParameters && isRenderableShellScript(node.kind(), task)) {
            if (parametersExpression == null) {
                task.remove("inputFiles");
                Map<String, String> managedEnv = buildTransferEnv();
                if (!managedEnv.isEmpty() && managedEnv.equals(task.get("env"))) {
                    task.remove("env");
                }
            } else {
                applyScriptParameters(task, node, parametersExpression);
            }
        }
        return task;
    }

    private static boolean supportsInlineParameters(Map<String, Object> task) {
        return task.get("type") instanceof String type
                && (isJdbcQueryTaskType(type) || HIVE_QUERY_TASK_TYPE.equals(type));
    }

    private static boolean isRenderableShellScript(String kind, Map<String, Object> task) {
        return task.get("type") instanceof String type
                && SHELL_COMMANDS_TASK_TYPE.equals(type)
                && ("SHELL".equalsIgnoreCase(kind) || "HIVE_SQL".equalsIgnoreCase(kind));
    }

    private void applyScriptParameters(Map<String, Object> task,
                                       OfflineFlowNode node,
                                       String parametersExpression) {
        task.put("inputFiles", Map.of("wb-data-script-parameters.json", parametersExpression));
        Map<String, String> env = buildTransferEnv();
        if (!env.isEmpty()) {
            task.put("env", env);
        }
        task.put("commands", buildScriptRenderCommands(node, castCommands(task.get("commands"))));
    }

    @SuppressWarnings("unchecked")
    private List<String> castCommands(Object commands) {
        if (commands instanceof List<?> list) {
            return (List<String>) list;
        }
        return List.of();
    }

    private List<String> buildScriptRenderCommands(OfflineFlowNode node, List<String> originalCommands) {
        String renderedPath = "/tmp/wb-data-script/" + node.taskId() + scriptExtension(node.scriptPath());
        String quotedScript = shellQuote(node.scriptPath());
        String quotedRendered = shellQuote(renderedPath);
        String requestPath = "/tmp/wb-data-script/" + node.taskId() + "-request.json";
        List<String> commands = new ArrayList<>();
        commands.add("set -eu");
        commands.add("mkdir -p /tmp/wb-data-script");
        commands.add("{ printf '%s' '{\"kind\":\"" + node.kind().toUpperCase(Locale.ROOT)
                + "\",\"script\":\"'; base64 -w 0 " + quotedScript
                + "; printf '%s' '\",\"parameters\":'; cat 'wb-data-script-parameters.json'; printf '%s' '}'; } > "
                + shellQuote(requestPath));
        commands.add("curl --fail --show-error --silent -H \"X-WB-Data-Internal-Token: ${"
                + transferRuntimeSettings.internalTokenEnv() + "}\" -H 'Content-Type: application/json' --data-binary @"
                + shellQuote(requestPath) + " \"${" + transferRuntimeSettings.internalBaseUrlEnv()
                + "}/api/v1/internal/offline/script/render\" -o " + quotedRendered);
        for (String command : originalCommands) {
            commands.add(command.replace(quotedScript, quotedRendered));
        }
        return commands;
    }

    private String scriptExtension(String scriptPath) {
        if (scriptPath == null) {
            return "";
        }
        int slash = Math.max(scriptPath.lastIndexOf('/'), scriptPath.lastIndexOf('\\'));
        int dot = scriptPath.lastIndexOf('.');
        if (dot > slash) {
            return scriptPath.substring(dot);
        }
        return "";
    }

    static String resolveKestraQueryTaskType(String dataSourceType) {
        String normalizedType = dataSourceType == null ? "" : dataSourceType.trim().toUpperCase();
        return switch (normalizedType) {
            case "MYSQL" -> WB_DATA_JDBC_TASK_PREFIX + "mysql.Query";
            case "POSTGRESQL" -> WB_DATA_JDBC_TASK_PREFIX + "postgresql.Query";
            case "CLICKHOUSE" -> WB_DATA_JDBC_TASK_PREFIX + "clickhouse.Query";
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
        if (OfflineFlowNodeKinds.isJdbcSql(kind)) {
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
            Map<String, String> env = buildTransferEnv();
            if (!env.isEmpty()) {
                task.put("env", env);
            }
            if (transferRuntimeSettings.runner() == TransferRunner.DOCKER) {
                task.put("containerImage", transferRuntimeSettings.seatunnelImage());
                task.put("taskRunner", buildDockerTaskRunner(true));
            }
            task.put("commands", buildTransferCommands(node.taskId(), node.transferConfigPath()));
        }
    }

    private final class SqlTaskAdapter implements TaskAdapter {
        @Override
        public void compile(Map<String, Object> task,
                            OfflineFlowNode node,
                            Map<Long, DataSource> dataSourceMap) {
            clearJdbcTaskFields(task);
            clearShellTaskFields(task);
            Long dataSourceId = node.dataSourceId();
            DataSource dataSource = dataSourceId == null ? null : dataSourceMap.get(dataSourceId);
            if (dataSource == null) {
                task.put("type", SHELL_COMMANDS_TASK_TYPE);
                task.put("description", OfflineTaskMetadataCodec.mergeDataSource(
                        readOptionalString(task, "description"),
                        null,
                        node.dataSourceType(),
                        node.kind()
                ));
                task.put("namespaceFiles", buildNamespaceFilesConfig(node.scriptPath()));
                task.put("commands", List.of("cat " + shellQuote(node.scriptPath()) + " # No data source selected"));
                return;
            }

            String type = dataSource.getType().toUpperCase();
            String requiredType = OfflineFlowNodeKinds.requiredDataSourceType(node.kind());
            if (requiredType != null && !requiredType.equals(type)) {
                throw new ResponseStatusException(
                        HttpStatus.BAD_REQUEST,
                        "节点 " + node.taskId() + " 只能绑定 " + requiredType + " 数据源"
                );
            }
            Long groupId = requireGroupId(dataSource);
            task.put("type", resolveKestraQueryTaskType(type));
            task.put("description", OfflineTaskMetadataCodec.mergeDataSource(
                    readOptionalString(task, "description"),
                    dataSource.getId(),
                    type,
                    OfflineFlowNodeKinds.canonicalize(node.kind(), type)
            ));
            task.put("dataSourceId", dataSource.getId());
            task.put("groupId", groupId);
            applyInternalCredentialRefs(task);
            task.put("sql", String.format("{{ read('%s') }}", node.scriptPath()));
        }
    }

    private final class HiveSqlTaskAdapter implements TaskAdapter {
        @Override
        public void compile(Map<String, Object> task,
                            OfflineFlowNode node,
                            Map<Long, DataSource> dataSourceMap) {
            clearJdbcTaskFields(task);
            clearShellTaskFields(task);
            Long dataSourceId = node.dataSourceId();
            DataSource dataSource = dataSourceId == null ? null : dataSourceMap.get(dataSourceId);
            if (dataSource == null) {
                task.put("type", SHELL_COMMANDS_TASK_TYPE);
                task.put("description", OfflineTaskMetadataCodec.mergeDataSource(
                        readOptionalString(task, "description"),
                        null,
                        "HIVE",
                        "HIVE_SQL"
                ));
                task.put("namespaceFiles", buildNamespaceFilesConfig(node.scriptPath()));
                task.put("commands", List.of("cat " + shellQuote(node.scriptPath()) + " # No data source selected"));
                return;
            }

            String type = dataSource.getType() == null ? "" : dataSource.getType().trim().toUpperCase();
            if (!"HIVE".equals(type)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "HiveSQL 节点只能绑定 Hive 数据源: " + node.taskId());
            }
            Long groupId = requireGroupId(dataSource);
            Map<String, String> normalizedConf = OfflineHiveConfigStore.normalizeAndValidateNodeConf(
                    "HIVE_SQL", node.hiveConf());

            task.put("type", HIVE_QUERY_TASK_TYPE);
            task.put("description", OfflineTaskMetadataCodec.mergeDataSource(
                    readOptionalString(task, "description"),
                    dataSource.getId(),
                    type,
                    "HIVE_SQL"
            ));
            task.put("dataSourceId", dataSource.getId());
            task.put("groupId", groupId);
            applyInternalCredentialRefs(task);
            task.put("namespaceFiles", buildNamespaceFilesConfig(node.scriptPath()));
            task.put("scriptPath", node.scriptPath());
            if (!normalizedConf.isEmpty()) {
                task.put("hiveConf", new LinkedHashMap<>(normalizedConf));
            }
            if (transferRuntimeSettings.runner() == TransferRunner.DOCKER) {
                task.put("containerImage", transferRuntimeSettings.hiveSqlImage());
                task.put("taskRunner", buildDockerTaskRunner(false));
            }
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

    private Long requireGroupId(DataSource dataSource) {
        if (dataSource.getGroupId() == null) {
            throw new IllegalStateException("数据源缺少所属项目组 ID: " + dataSource.getId());
        }
        return dataSource.getGroupId();
    }

    private void applyInternalCredentialRefs(Map<String, Object> task) {
        if (transferRuntimeSettings.internalBaseUrl() != null && !transferRuntimeSettings.internalBaseUrl().isBlank()) {
            task.put("internalBaseUrl", transferRuntimeSettings.internalBaseUrl());
        }
        String tokenExpr = internalTokenSecretExpression();
        if (tokenExpr != null) {
            task.put("internalToken", tokenExpr);
        }
    }

    private Map<String, String> buildTransferEnv() {
        Map<String, String> env = new LinkedHashMap<>();
        putIfPresent(env, transferRuntimeSettings.internalBaseUrlEnv(), transferRuntimeSettings.internalBaseUrl());
        putIfPresent(env, transferRuntimeSettings.internalTokenEnv(), internalTokenSecretExpression());
        return env;
    }

    private String internalTokenSecretExpression() {
        String tokenEnv = transferRuntimeSettings.internalTokenEnv();
        if (tokenEnv == null || tokenEnv.isBlank()) {
            return null;
        }
        return "{{ secret('" + tokenEnv.trim() + "') }}";
    }

    private void putIfPresent(Map<String, String> env, String name, String value) {
        if (name != null && !name.isBlank() && value != null && !value.isBlank()) {
            env.put(name, value);
        }
    }

    private Map<String, Object> buildDockerTaskRunner(boolean includeVolumes) {
        Map<String, Object> taskRunner = new LinkedHashMap<>();
        taskRunner.put("type", "io.kestra.plugin.scripts.runner.docker.Docker");
        taskRunner.put("networkMode", transferRuntimeSettings.dockerNetwork());
        taskRunner.put("pullPolicy", "IF_NOT_PRESENT");
        if (includeVolumes) {
            List<String> dockerVolumes = transferRuntimeSettings.dockerVolumes() == null
                    ? List.of()
                    : transferRuntimeSettings.dockerVolumes().stream()
                    .filter(volume -> volume != null && !volume.isBlank())
                    .toList();
            if (!dockerVolumes.isEmpty()) {
                taskRunner.put("volumes", new ArrayList<>(dockerVolumes));
            }
        }
        return taskRunner;
    }

    private List<String> buildTransferCommands(String taskId, String transferConfigPath) {
        String renderedConfigPath = "/tmp/wb-data-transfer/" + taskId + ".conf";
        String requestPath = "/tmp/wb-data-transfer/" + taskId + "-request.json";
        return List.of(
                "set -eu",
                "mkdir -p /tmp/wb-data-transfer",
                "{ printf '%s' '{\"config\":'; cat " + shellQuote(transferConfigPath)
                        + "; printf '%s' ',\"parameters\":'; cat 'wb-data-transfer-parameters.json'; printf '%s' '}'; } > "
                        + shellQuote(requestPath),
                "curl --fail --show-error --silent -H \"X-WB-Data-Internal-Token: ${"
                        + transferRuntimeSettings.internalTokenEnv() + "}\" -H 'Content-Type: application/json' "
                        + "--data-binary @" + shellQuote(requestPath) + " \"${"
                        + transferRuntimeSettings.internalBaseUrlEnv() + "}/api/v1/internal/offline/transfer/render\" "
                        + "-o " + renderedConfigPath,
                buildTransferSqlCommand("pre-sql", requestPath),
                seatunnelBinary() + " --config " + renderedConfigPath + " -m local",
                buildTransferSqlCommand("post-sql", requestPath)
        );
    }

    private String buildTransferSqlCommand(String phase, String requestPath) {
        return "curl --fail --show-error --silent -H \"X-WB-Data-Internal-Token: ${"
                + transferRuntimeSettings.internalTokenEnv() + "}\" -H 'Content-Type: application/json' "
                + "--data-binary @" + shellQuote(requestPath) + " \"${"
                + transferRuntimeSettings.internalBaseUrlEnv() + "}/api/v1/internal/offline/transfer/" + phase + "\"";
    }

    private String seatunnelBinary() {
        String home = transferRuntimeSettings.seatunnelHome();
        if (home.endsWith("/")) {
            return home + "bin/seatunnel.sh";
        }
        return home + "/bin/seatunnel.sh";
    }

    private Map<String, Object> buildNamespaceFilesConfig(String scriptPath) {
        Map<String, Object> namespaceFiles = new LinkedHashMap<>();
        namespaceFiles.put("enabled", true);
        namespaceFiles.put("include", List.of(scriptPath));
        return namespaceFiles;
    }

    private String shellQuote(String value) {
        return "'" + (value == null ? "" : value.replace("'", "'\"'\"'")) + "'";
    }

    private void clearShellTaskFields(Map<String, Object> task) {
        task.remove("namespaceFiles");
        task.remove("inputFiles");
        task.remove("env");
        task.remove("commands");
        task.remove("containerImage");
        task.remove("taskRunner");
        task.remove("scriptPath");
        task.remove("hiveConf");
        task.remove("labels");
        OfflineTaskMetadataCodec.cleanup(task);
    }

    private void clearJdbcTaskFields(Map<String, Object> task) {
        task.remove("url");
        task.remove("username");
        task.remove("password");
        task.remove("dataSourceId");
        task.remove("groupId");
        task.remove("internalBaseUrl");
        task.remove("internalToken");
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
        task.remove("scriptPath");
        task.remove("hiveConf");
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
            List<String> dockerVolumes,
            TransferRunner runner,
            String seatunnelHome,
            String hiveSqlImage
    ) {
    }
}
