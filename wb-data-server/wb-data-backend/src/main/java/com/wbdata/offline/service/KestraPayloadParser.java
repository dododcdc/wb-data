package com.wbdata.offline.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wbdata.offline.kestra.KestraExecutionSnapshot;
import com.wbdata.offline.kestra.KestraLogEntry;
import com.wbdata.offline.kestra.KestraTaskRunSnapshot;

import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Kestra API JSON payload 的解析：执行快照、校验违规、日志、插件任务类型清单。
 * 只读 JSON，不发起网络请求。
 */
final class KestraPayloadParser {

    static final String DOCKER_TASK_RUNNER_TYPE = "io.kestra.plugin.scripts.runner.docker.Docker";

    private final ObjectMapper objectMapper;

    KestraPayloadParser(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    JsonNode readTree(byte[] payload) throws IOException {
        return objectMapper.readTree(payload);
    }

    KestraExecutionSnapshot readExecution(byte[] payload) {
        try {
            return readExecution(objectMapper.readTree(payload));
        } catch (IOException ex) {
            throw new IllegalStateException("解析 Kestra 执行详情失败", ex);
        }
    }

    KestraExecutionSnapshot readExecution(JsonNode root) {
        JsonNode state = root.path("state");
        List<KestraTaskRunSnapshot> taskRuns = new ArrayList<>();
        JsonNode taskRunList = root.path("taskRunList");
        if (taskRunList.isArray()) {
            for (JsonNode taskRun : taskRunList) {
                JsonNode taskState = taskRun.path("state");
                taskRuns.add(new KestraTaskRunSnapshot(
                        readText(taskRun.path("taskId")),
                        readText(taskState.path("current")),
                        readInstant(taskState.path("startDate"), taskRun.path("startDate")),
                        readInstant(taskState.path("endDate"), taskRun.path("endDate"))
                ));
            }
        }

        return new KestraExecutionSnapshot(
                readText(root.path("id")),
                readText(root.path("namespace")),
                readText(root.path("flowId")),
                readText(state.path("current")),
                readInstant(root.path("trigger").path("variables").path("date")),
                readInstant(state.path("startDate"), firstHistoryDate(state), root.path("createdAt"), root.path("createdDate")),
                readInstant(state.path("startDate"), root.path("startDate")),
                readInstant(state.path("endDate"), root.path("endDate")),
                taskRuns,
                readStringMap(root.path("inputs")),
                readLabels(root.path("labels"))
        );
    }

    List<String> readViolations(byte[] payload) {
        try {
            JsonNode root = objectMapper.readTree(payload);
            List<String> violations = new ArrayList<>();
            if (root.isArray()) {
                for (JsonNode item : root) {
                    String constraints = readText(item.path("constraints"));
                    if (constraints != null && !constraints.isBlank()) {
                        violations.add(constraints);
                    }
                }
            }
            return violations;
        } catch (IOException ex) {
            throw new IllegalStateException("解析 Kestra 校验结果失败", ex);
        }
    }

    List<KestraLogEntry> readLogs(byte[] payload, String taskId) {
        try {
            JsonNode root = objectMapper.readTree(payload);
            List<KestraLogEntry> entries = new ArrayList<>();
            if (root.isArray()) {
                for (JsonNode item : root) {
                    KestraLogEntry entry = new KestraLogEntry(
                            readInstant(item.path("timestamp"), item.path("date")),
                            readText(item.path("taskId")),
                            readText(item.path("level")),
                            readText(item.path("message"))
                    );
                    if (taskId == null || taskId.equals(entry.taskId())) {
                        entries.add(entry);
                    }
                }
            }
            return entries;
        } catch (IOException ex) {
            throw new IllegalStateException("解析 Kestra 日志失败", ex);
        }
    }

    String readFlowSource(byte[] payload) {
        try {
            return readText(objectMapper.readTree(payload).path("source"));
        } catch (IOException ex) {
            throw new IllegalStateException("解析 Kestra Flow 源码失败", ex);
        }
    }

    Set<String> readTaskTypes(byte[] payload) {
        try {
            JsonNode root = objectMapper.readTree(payload);
            Set<String> taskTypes = new LinkedHashSet<>();
            if (root.isArray()) {
                for (JsonNode plugin : root) {
                    JsonNode tasks = plugin.path("tasks");
                    if (tasks.isArray()) {
                        for (JsonNode task : tasks) {
                            String cls = readText(task.path("cls"));
                            if (cls != null && !cls.isBlank()) {
                                taskTypes.add(cls);
                            }
                        }
                    }
                    JsonNode aliases = plugin.path("aliases");
                    if (aliases.isArray()) {
                        for (JsonNode alias : aliases) {
                            String value = readText(alias);
                            if (value != null && !value.isBlank()) {
                                taskTypes.add(value);
                            }
                        }
                    }
                    JsonNode taskRunners = plugin.path("taskRunners");
                    if (taskRunners.isArray()) {
                        for (JsonNode taskRunner : taskRunners) {
                            String cls = readText(taskRunner.path("cls"));
                            if (cls != null && !cls.isBlank()) {
                                taskTypes.add(cls);
                            }
                        }
                    }
                    if (isDockerPlugin(plugin)) {
                        taskTypes.add(DOCKER_TASK_RUNNER_TYPE);
                    }
                }
            }
            return Set.copyOf(taskTypes);
        } catch (IOException ex) {
            throw new IllegalStateException("解析 Kestra 插件列表失败", ex);
        }
    }

    private boolean isDockerPlugin(JsonNode plugin) {
        return "plugin-docker".equals(readText(plugin.path("name")))
                || "io.kestra.plugin.docker".equals(readText(plugin.path("group")))
                || "io.kestra.plugin.docker".equals(readText(plugin.path("manifest").path("X-Kestra-Group")));
    }

    private JsonNode firstHistoryDate(JsonNode state) {
        JsonNode histories = state.path("histories");
        if (histories.isArray() && !histories.isEmpty()) {
            return histories.get(0).path("date");
        }
        return objectMapper.nullNode();
    }

    private String readText(JsonNode node) {
        return node == null || node.isMissingNode() || node.isNull() ? null : node.asText();
    }

    private Map<String, String> readStringMap(JsonNode node) {
        if (node == null || node.isMissingNode() || node.isNull()) {
            return Map.of();
        }
        Map<String, String> values = new LinkedHashMap<>();
        if (node.isObject()) {
            node.fields().forEachRemaining(entry -> {
                JsonNode value = entry.getValue();
                values.put(entry.getKey(), value.isValueNode() ? readText(value) : value.toString());
            });
        }
        return values;
    }

    private Map<String, String> readLabels(JsonNode labelsNode) {
        if (labelsNode == null) {
            return Map.of();
        }
        Map<String, String> labels = new LinkedHashMap<>();
        if (labelsNode.isArray()) {
            for (JsonNode element : labelsNode) {
                if (element.has("key") && element.has("value")) {
                    labels.put(element.get("key").asText(), readText(element.get("value")));
                }
            }
        } else if (labelsNode.isObject()) {
            labelsNode.fields().forEachRemaining(entry -> labels.put(entry.getKey(), readText(entry.getValue())));
        }
        return labels;
    }

    private Instant readInstant(JsonNode... candidates) {
        for (JsonNode candidate : candidates) {
            String value = readText(candidate);
            if (value != null && !value.isBlank()) {
                return Instant.parse(value);
            }
        }
        return null;
    }
}
