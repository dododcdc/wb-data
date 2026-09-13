package com.wbdata.offline.service;

import com.wbdata.offline.dto.FlowParameterDefinitionSnapshot;
import com.wbdata.offline.dto.FlowParameterSnapshot;
import com.wbdata.offline.dto.ExecutionParameterValueResponse;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.Collections;
import java.util.Locale;
import java.util.Map;
import java.util.List;
import java.util.Set;
import java.util.ArrayList;

public final class ExecutionParameterResolver {

    public ExecutionParameterResolver() {
    }

    public Map<String, String> resolveOverrides(FlowParameterSnapshot snapshot,
                                                Map<String, String> requestedOverrides) {
        if (requestedOverrides == null || requestedOverrides.isEmpty()) {
            return Map.of();
        }
        if (snapshot == null) {
            throw badRequest("当前任务 未绑定参数组，不能设置执行参数");
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

        Map<String, String> resolved = new LinkedHashMap<>();
        for (Map.Entry<String, String> override : requestedOverrides.entrySet()) {
            String key = override.getKey();
            FlowParameterDefinitionSnapshot definition = key == null ? null : definitions.get(key);
            if (definition == null) {
                throw badRequest("执行参数未在任务参数快照中定义: " + key);
            }
            if (override.getValue() == null) {
                throw badRequest("V1 不支持 null 执行参数: " + definition.key());
            }
            resolved.put(key, override.getValue());
        }
        return Collections.unmodifiableMap(resolved);
    }

    public Resolution resolveExecution(FlowParameterSnapshot snapshot,
                                       Map<String, String> executionInputs,
                                       ExecutionTimeContext timeContext,
                                       Set<String> manualOverrideKeys) {
        Map<String, String> inputs = executionInputs == null ? Map.of() : executionInputs;
        Set<String> overrideKeys = manualOverrideKeys == null ? Set.of() : manualOverrideKeys;
        List<ExecutionParameterValueResponse> parameters = new ArrayList<>();
        boolean pending = false;
        boolean unavailable = false;

        for (FlowParameterDefinitionSnapshot definition : snapshot.definitions()) {
            String explicitValue = inputs.get(definition.key());
            String source;
            String value;
            if (overrideKeys.contains(definition.key())) {
                source = "MANUAL_OVERRIDE";
                value = explicitValue;
                unavailable = unavailable || value == null;
            } else if ("CONSTANT".equals(definition.valueSource())) {
                source = "CONSTANT";
                value = definition.constantValue();
                unavailable = unavailable || value == null;
            } else if (explicitValue != null) {
                source = "EXPLICIT_INPUT";
                value = explicitValue;
            } else if (resolveReferenceTime(definition, timeContext) == null) {
                source = "SYSTEM_TIME";
                value = null;
                pending = true;
            } else {
                source = "SYSTEM_TIME";
                value = resolveSystemTime(
                        definition, resolveReferenceTime(definition, timeContext), snapshot.runtimeTimezone());
            }
            parameters.add(new ExecutionParameterValueResponse(
                    definition.key(), "STRING", value, source));
        }
        String status = unavailable ? "UNAVAILABLE" : pending ? "PENDING" : "AVAILABLE";
        return new Resolution(status, List.copyOf(parameters));
    }

    private Instant resolveReferenceTime(FlowParameterDefinitionSnapshot definition,
                                         ExecutionTimeContext timeContext) {
        if (timeContext == null) {
            return null;
        }
        String timeBasis = definition.timeBasis() == null ? "PLANNED_TIME" : definition.timeBasis();
        return switch (timeBasis) {
            case "PLANNED_TIME" -> timeContext.plannedTime();
            case "EXECUTION_START_TIME" -> timeContext.executionStartTime();
            default -> throw badRequest("时间参数基准不支持: " + definition.key());
        };
    }

    private String resolveSystemTime(FlowParameterDefinitionSnapshot definition,
                                     Instant referenceTime,
                                     String runtimeTimezone) {
        if (runtimeTimezone == null || runtimeTimezone.isBlank()) {
            throw badRequest("任务运行时区不能为空");
        }
        var time = referenceTime.atZone(ZoneId.of(runtimeTimezone))
                .plusDays(definition.offsetDays() == null ? 0 : definition.offsetDays());
        return time.format(DateTimeFormatter.ofPattern(definition.format(), Locale.ROOT));
    }

    private ResponseStatusException badRequest(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }

    public record Resolution(
            String status,
            List<ExecutionParameterValueResponse> parameters
    ) {
    }
}
