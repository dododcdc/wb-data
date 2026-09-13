package com.wbdata.offline.service;

import com.wbdata.offline.dto.FlowParameterDefinitionSnapshot;
import com.wbdata.offline.dto.FlowParameterSnapshot;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

final class FlowParameterCompiler {
    private final SqlNamedParameterScanner scanner = new SqlNamedParameterScanner();

    Compilation compile(FlowParameterSnapshot snapshot,
                        List<OfflineFlowNode> nodes,
                        Map<String, String> scriptContents) {
        Map<String, FlowParameterDefinitionSnapshot> definitions = indexDefinitions(snapshot);
        String runtimeTimezone = snapshot == null ? null : snapshot.runtimeTimezone();
        Map<String, String> taskExpressions = new LinkedHashMap<>();

        for (OfflineFlowNode node : nodes) {
            if (!OfflineFlowNodeKinds.isJdbcSql(node.kind())) {
                continue;
            }
            String sql = scriptContents.get(node.scriptPath());
            if (sql == null) {
                throw badRequest("SQL 节点“" + node.taskId() + "”缺少脚本内容");
            }
            SqlNamedParameterScanner.Analysis analysis;
            try {
                analysis = scanner.scan(sql);
            } catch (IllegalArgumentException ex) {
                throw badRequest("SQL 节点“" + node.taskId() + "”参数语法错误: " + ex.getMessage());
            }
            Set<String> referenced = analysis.parameters();
            List<String> missing = referenced.stream().filter(key -> !definitions.containsKey(key)).toList();
            if (!missing.isEmpty()) {
                throw badRequest("SQL 节点“" + node.taskId() + "”引用了未定义参数: "
                        + String.join(", ", missing));
            }
            if (!referenced.isEmpty()) {
                taskExpressions.put(node.taskId(), buildParametersExpression(
                        definitions, referenced, runtimeTimezone));
            }
        }

        List<Map<String, Object>> inputs = snapshot == null
                ? List.of()
                : buildInputs(snapshot.definitions(), runtimeTimezone);
        return new Compilation(inputs, taskExpressions);
    }

    private Map<String, FlowParameterDefinitionSnapshot> indexDefinitions(FlowParameterSnapshot snapshot) {
        if (snapshot == null) {
            return Map.of();
        }
        Map<String, FlowParameterDefinitionSnapshot> definitions = new LinkedHashMap<>();
        for (FlowParameterDefinitionSnapshot definition : snapshot.definitions()) {
            if (definition == null || definition.key() == null || definition.key().isBlank()) {
                throw badRequest("参数快照中存在无效参数定义");
            }
            if (definitions.putIfAbsent(definition.key(), definition) != null) {
                throw badRequest("参数快照中存在重复参数: " + definition.key());
            }
        }
        return definitions;
    }

    private Map<String, Object> buildInput(FlowParameterDefinitionSnapshot definition,
                                           String runtimeTimezone) {
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("id", definition.key());
        input.put("type", "STRING");
        if ("CONSTANT".equals(definition.valueSource())) {
            input.put("defaults", parseConstant(definition));
        } else if ("SYSTEM_TIME".equals(definition.valueSource())) {
            validateSystemTime(definition, runtimeTimezone);
            input.put("required", false);
        } else {
            throw badRequest("参数“" + definition.key() + "”的值来源不支持: " + definition.valueSource());
        }
        return input;
    }

    private List<Map<String, Object>> buildInputs(List<FlowParameterDefinitionSnapshot> definitions,
                                                  String runtimeTimezone) {
        List<Map<String, Object>> inputs = new ArrayList<>(definitions.stream()
                .map(definition -> buildInput(definition, runtimeTimezone))
                .toList());
        boolean needsPlannedTime = definitions.stream()
                .anyMatch(definition -> "SYSTEM_TIME".equals(definition.valueSource())
                        && "PLANNED_TIME".equals(resolveTimeBasis(definition)));
        if (needsPlannedTime) {
            inputs.add(Map.of(
                    "id", ExecutionTimeContext.PLANNED_TIME_INPUT,
                    "type", "DATETIME",
                    "required", false
            ));
        }
        return List.copyOf(inputs);
    }

    private String parseConstant(FlowParameterDefinitionSnapshot definition) {
        String value = definition.constantValue();
        if (value == null) {
            throw badRequest("常量参数“" + definition.key() + "”缺少值");
        }
        return value;
    }

    private void validateSystemTime(FlowParameterDefinitionSnapshot definition,
                                    String runtimeTimezone) {
        resolveTimeBasis(definition);
        if (runtimeTimezone == null || runtimeTimezone.isBlank()) {
            throw badRequest("任务运行时区不能为空");
        }
        try {
            ZoneId.of(runtimeTimezone);
        } catch (RuntimeException ex) {
            throw badRequest("任务运行时区不合法");
        }
        String format = definition.format();
        if (format == null || format.isBlank()) {
            throw badRequest("时间参数“" + definition.key() + "”缺少格式");
        }
        try {
            DateTimeFormatter.ofPattern(format, Locale.ROOT);
        } catch (IllegalArgumentException ex) {
            throw badRequest("时间参数“" + definition.key() + "”的格式不合法");
        }
    }

    private String buildParametersExpression(Map<String, FlowParameterDefinitionSnapshot> definitions,
                                             Set<String> referenced,
                                             String runtimeTimezone) {
        List<String> entries = new ArrayList<>();
        for (FlowParameterDefinitionSnapshot definition : definitions.values()) {
            if (referenced.contains(definition.key())) {
                entries.add("\"" + escapeExpressionString(definition.key()) + "\": "
                        + buildValueExpression(definition, runtimeTimezone));
            }
        }
        return "{{ {" + String.join(", ", entries) + "} | toJson }}";
    }

    private String buildValueExpression(FlowParameterDefinitionSnapshot definition,
                                        String runtimeTimezone) {
        if ("CONSTANT".equals(definition.valueSource())) {
            return "inputs." + definition.key();
        }
        validateSystemTime(definition, runtimeTimezone);
        int offset = definition.offsetDays() == null ? 0 : definition.offsetDays();
        String reference = "PLANNED_TIME".equals(resolveTimeBasis(definition))
                ? "(inputs.wbdata_planned_time ?? trigger.date)"
                : "execution.startDate";
        StringBuilder fallback = new StringBuilder("(").append(reference);
        if (offset != 0) {
            fallback.append(" | timestampMilli | dateAdd(")
                    .append(offset)
                    .append(", \"DAYS\", format=\"")
                    .append(escapeExpressionString(definition.format()))
                    .append("\", timeZone=\"")
                    .append(escapeExpressionString(runtimeTimezone))
                    .append("\")");
        } else {
            fallback.append(" | date(\"")
                    .append(escapeExpressionString(definition.format()))
                    .append("\", timeZone=\"")
                    .append(escapeExpressionString(runtimeTimezone))
                    .append("\")");
        }
        fallback.append(")");
        return "(inputs." + definition.key() + " ?? " + fallback + ")";
    }

    private String resolveTimeBasis(FlowParameterDefinitionSnapshot definition) {
        String timeBasis = definition.timeBasis() == null ? "PLANNED_TIME" : definition.timeBasis();
        if (!Set.of("PLANNED_TIME", "EXECUTION_START_TIME").contains(timeBasis)) {
            throw badRequest("时间参数“" + definition.key() + "”的时间基准不支持: " + timeBasis);
        }
        return timeBasis;
    }

    private String escapeExpressionString(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private ResponseStatusException badRequest(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }

    record Compilation(
            List<Map<String, Object>> inputs,
            Map<String, String> taskParameterExpressions
    ) {
        String parametersForTask(String taskId) {
            return taskParameterExpressions.get(taskId);
        }
    }
}
