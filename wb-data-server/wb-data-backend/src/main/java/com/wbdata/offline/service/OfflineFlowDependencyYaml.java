package com.wbdata.offline.service;

import com.wbdata.offline.dto.OfflineFlowDependencyRef;
import com.wbdata.offline.dto.OfflineFlowDependencySettings;
import com.wbdata.offline.enums.OfflineCrossGroupDependency;
import com.wbdata.offline.enums.OfflineFailurePolicy;
import com.wbdata.offline.enums.OfflineSchedulePeriod;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 前置依赖 labels 与依赖闸门（WaitUpstream task + 旁路/计划时间 input）的编译。
 * 闸门内容完全由 YAML 自身推导（namespace 的 pg-N、依赖/策略 labels、调度 trigger），
 * 所有改动调度或依赖的编译路径在收尾时调用一次 {@link #applyDependencyGate} 即可保持一致；
 * 无依赖时自动剥除；debug 旁路用 {@link #stripDependencyGate}。
 */
final class OfflineFlowDependencyYaml {

    static final String DEPENDENCIES_LABEL = "wbdataDependencies";
    static final String FAILURE_POLICY_LABEL = "wbdataFailurePolicy";
    static final String CROSS_GROUP_DEPENDENCY_LABEL = "wbdataCrossGroupDependency";
    static final String GATE_TASK_ID = "wb_upstream_gate";
    static final String GATE_TASK_TYPE = "io.wbdata.kestra.core.WaitUpstream";
    static final String BYPASS_GATE_INPUT = "wbdata_bypass_gate";
    private static final java.util.regex.Pattern REPO_NAMESPACE_PATTERN =
            java.util.regex.Pattern.compile("^pg-(\\d+)$");

    private final FlowYamlCodec yaml;
    private final OfflineFlowScheduleYaml scheduleYaml;

    OfflineFlowDependencyYaml(FlowYamlCodec yaml, OfflineFlowScheduleYaml scheduleYaml) {
        this.yaml = yaml;
        this.scheduleYaml = scheduleYaml;
    }

    OfflineFlowDependencySettings readDependencyConfig(String source) {
        return new OfflineFlowDependencySettings(
                readDependencies(source), readFailurePolicy(source), readCrossGroupDependency(source));
    }

    List<OfflineFlowDependencyRef> readDependencies(String source) {
        return parseDependenciesLabel(readLabel(source, DEPENDENCIES_LABEL));
    }

    static List<OfflineFlowDependencyRef> parseDependenciesLabel(String value) {
        if (value == null || value.isBlank()) {
            return List.of();
        }
        List<OfflineFlowDependencyRef> refs = new ArrayList<>();
        for (String entry : value.split(",")) {
            String trimmed = entry.trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            int separator = trimmed.indexOf(':');
            if (separator <= 0 || separator == trimmed.length() - 1) {
                continue;
            }
            try {
                long groupId = Long.parseLong(trimmed.substring(0, separator).trim());
                String flowId = trimmed.substring(separator + 1).trim();
                if (!flowId.isEmpty()) {
                    refs.add(new OfflineFlowDependencyRef(groupId, flowId));
                }
            } catch (NumberFormatException ignored) {
                // 忽略无法解析的历史 label 项
            }
        }
        return List.copyOf(refs);
    }

    static String encodeDependencies(List<OfflineFlowDependencyRef> dependencies) {
        return String.join(",", dependencies.stream()
                .map(ref -> ref.groupId() + ":" + ref.flowId())
                .toList());
    }

    OfflineFailurePolicy readFailurePolicy(String source) {
        return parseEnumLabel(readLabel(source, FAILURE_POLICY_LABEL),
                OfflineFailurePolicy.class, OfflineFailurePolicy.CONTINUE);
    }

    OfflineCrossGroupDependency readCrossGroupDependency(String source) {
        return parseEnumLabel(readLabel(source, CROSS_GROUP_DEPENDENCY_LABEL),
                OfflineCrossGroupDependency.class, OfflineCrossGroupDependency.ALLOW);
    }

    private String readLabel(String source, String key) {
        return yaml.readLabelValue(yaml.loadRoot(source), key);
    }

    private static <E extends Enum<E>> E parseEnumLabel(String value, Class<E> type, E fallback) {
        if (value == null || value.isBlank()) {
            return fallback;
        }
        try {
            return Enum.valueOf(type, value.trim().toUpperCase());
        } catch (IllegalArgumentException ex) {
            return fallback;
        }
    }

    String applyDependencyConfig(String source,
                                 List<OfflineFlowDependencyRef> dependencies,
                                 OfflineFailurePolicy failurePolicy,
                                 OfflineCrossGroupDependency crossGroupDependency) {
        Map<String, Object> root = yaml.loadRoot(source);
        Map<String, Object> labels = new LinkedHashMap<>();
        labels.putAll(yaml.asStringObjectMap(root.get("labels")));
        if (dependencies == null || dependencies.isEmpty()) {
            labels.remove(DEPENDENCIES_LABEL);
        } else {
            labels.put(DEPENDENCIES_LABEL, encodeDependencies(dependencies));
        }
        if (failurePolicy == null || failurePolicy == OfflineFailurePolicy.CONTINUE) {
            labels.remove(FAILURE_POLICY_LABEL);
        } else {
            labels.put(FAILURE_POLICY_LABEL, failurePolicy.name());
        }
        if (crossGroupDependency == null || crossGroupDependency == OfflineCrossGroupDependency.ALLOW) {
            labels.remove(CROSS_GROUP_DEPENDENCY_LABEL);
        } else {
            labels.put(CROSS_GROUP_DEPENDENCY_LABEL, crossGroupDependency.name());
        }
        if (labels.isEmpty()) {
            root.remove("labels");
        } else {
            root.put("labels", labels);
        }
        return applyDependencyGate(yaml.dump(root));
    }

    String applyDependencyGate(String source) {
        Map<String, Object> root = yaml.loadRoot(source);
        List<Map<String, Object>> tasks = new ArrayList<>();
        if (root.get("tasks") instanceof List<?> rawTasks) {
            for (Object rawTask : rawTasks) {
                if (rawTask instanceof Map<?, ?> taskMap) {
                    tasks.add(new LinkedHashMap<>((Map<String, Object>) taskMap));
                }
            }
        }
        tasks.removeIf(task -> GATE_TASK_ID.equals(yaml.readOptionalString(task, "id")));
        removeGateInputs(root);

        List<OfflineFlowDependencyRef> dependencies = readDependencies(source);
        if (dependencies.isEmpty()) {
            root.put("tasks", tasks);
            return yaml.dump(root);
        }

        OfflineFlowYamlSupport.ScheduleData schedule = scheduleYaml.readSchedule(source);
        if (schedule == null || schedule.period() == null || schedule.period() == OfflineSchedulePeriod.CUSTOM) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "配置前置依赖需要先配置标准调度频率");
        }
        java.util.regex.Matcher namespaceMatcher = REPO_NAMESPACE_PATTERN
                .matcher(yaml.requiredString(root, "namespace"));
        if (!namespaceMatcher.matches()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "任务命名空间不合法，无法生成依赖闸门");
        }

        Map<String, Object> gate = new LinkedHashMap<>();
        gate.put("id", GATE_TASK_ID);
        gate.put("type", GATE_TASK_TYPE);
        gate.put("selfGroupId", namespaceMatcher.group(1));
        List<Map<String, Object>> upstreams = new ArrayList<>();
        for (OfflineFlowDependencyRef ref : dependencies) {
            Map<String, Object> upstream = new LinkedHashMap<>();
            upstream.put("groupId", String.valueOf(ref.groupId()));
            upstream.put("flowId", ref.flowId());
            upstreams.add(upstream);
        }
        gate.put("upstreams", upstreams);
        gate.put("period", schedule.period().name());
        gate.put("cron", schedule.cron());
        if (schedule.timezone() != null && !schedule.timezone().isBlank()) {
            gate.put("timezone", schedule.timezone());
        }
        gate.put("plannedTime", "{{ inputs.wbdata_planned_time ?? trigger.date }}");
        gate.put("failurePolicy", readFailurePolicy(source).name());
        gate.put("bypass", "{{ inputs.wbdata_bypass_gate ?? false }}");
        tasks.add(0, gate);
        root.put("tasks", tasks);

        ensureGateInputs(root);
        return yaml.dump(root);
    }

    /** debug 执行旁路依赖闸门（已拍板）：剥除闸门 task 与旁路 input 声明。 */
    void stripDependencyGate(Map<String, Object> root) {
        if (root.get("tasks") instanceof List<?> rawTasks) {
            List<Map<String, Object>> retained = new ArrayList<>();
            for (Object rawTask : rawTasks) {
                if (rawTask instanceof Map<?, ?> taskMap
                        && !GATE_TASK_ID.equals(yaml.readOptionalString((Map<String, Object>) taskMap, "id"))) {
                    retained.add((Map<String, Object>) taskMap);
                }
            }
            root.put("tasks", retained);
        }
        removeGateInputs(root);
    }

    /** 闸门专用 input 声明：按 id 合并，不覆盖参数编译已声明的同义 input。 */
    private void ensureGateInputs(Map<String, Object> root) {
        List<Map<String, Object>> inputs = mutableInputs(root);
        if (inputs.stream().noneMatch(input -> ExecutionTimeContext.PLANNED_TIME_INPUT.equals(input.get("id")))) {
            Map<String, Object> plannedTime = new LinkedHashMap<>();
            plannedTime.put("id", ExecutionTimeContext.PLANNED_TIME_INPUT);
            plannedTime.put("type", "DATETIME");
            plannedTime.put("required", false);
            inputs.add(plannedTime);
        }
        if (inputs.stream().noneMatch(input -> BYPASS_GATE_INPUT.equals(input.get("id")))) {
            Map<String, Object> bypass = new LinkedHashMap<>();
            bypass.put("id", BYPASS_GATE_INPUT);
            bypass.put("type", "BOOL");
            bypass.put("defaults", false);
            inputs.add(bypass);
        }
        root.put("inputs", inputs);
    }

    private void removeGateInputs(Map<String, Object> root) {
        if (!(root.get("inputs") instanceof List<?> rawInputs)) {
            return;
        }
        List<Map<String, Object>> retained = new ArrayList<>();
        for (Object rawInput : rawInputs) {
            if (rawInput instanceof Map<?, ?> inputMap
                    && !BYPASS_GATE_INPUT.equals(((Map<String, Object>) inputMap).get("id"))) {
                retained.add(new LinkedHashMap<>((Map<String, Object>) inputMap));
            }
        }
        if (retained.isEmpty()) {
            root.remove("inputs");
        } else {
            root.put("inputs", retained);
        }
    }

    private List<Map<String, Object>> mutableInputs(Map<String, Object> root) {
        List<Map<String, Object>> inputs = new ArrayList<>();
        if (root.get("inputs") instanceof List<?> rawInputs) {
            for (Object rawInput : rawInputs) {
                if (rawInput instanceof Map<?, ?> inputMap) {
                    inputs.add(new LinkedHashMap<>((Map<String, Object>) inputMap));
                }
            }
        }
        return inputs;
    }
}
