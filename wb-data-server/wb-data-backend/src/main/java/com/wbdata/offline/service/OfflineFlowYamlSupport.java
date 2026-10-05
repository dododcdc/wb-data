package com.wbdata.offline.service;

import com.wbdata.offline.config.OfflineTransferProperties;
import com.wbdata.offline.dto.OfflineFlowDependencyRef;
import com.wbdata.offline.dto.OfflineFlowDependencySettings;
import com.wbdata.offline.dto.OfflineFlowSchedule;
import com.wbdata.offline.enums.OfflineCrossGroupDependency;
import com.wbdata.offline.enums.OfflineFailurePolicy;
import com.wbdata.offline.enums.OfflineSchedulePeriod;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

final class OfflineFlowYamlSupport {
    static final String SCHEDULE_PERIOD_LABEL = "wbdataSchedulePeriod";
    static final String DEPENDENCIES_LABEL = "wbdataDependencies";
    static final String FAILURE_POLICY_LABEL = "wbdataFailurePolicy";
    static final String CROSS_GROUP_DEPENDENCY_LABEL = "wbdataCrossGroupDependency";
    static final String GATE_TASK_ID = "wb_upstream_gate";
    static final String GATE_TASK_TYPE = "io.wbdata.kestra.core.WaitUpstream";
    static final String BYPASS_GATE_INPUT = "wbdata_bypass_gate";
    private static final java.util.regex.Pattern REPO_NAMESPACE_PATTERN =
            java.util.regex.Pattern.compile("^pg-(\\d+)$");
    private static final String RECOVER_MISSED_SCHEDULES_NONE = "NONE";
    private static final java.util.regex.Pattern READ_CALL_PATTERN =
            java.util.regex.Pattern.compile("\\{\\{\\s*read\\(\\s*['\"]([^'\"]+)['\"]\\s*\\)\\s*}}");

    private final FlowYamlCodec yaml;
    private final OfflineNodeTaskCompiler nodeTaskCompiler;

    OfflineFlowYamlSupport() {
        this(new OfflineNodeTaskCompiler());
    }

    OfflineFlowYamlSupport(OfflineTransferProperties transferProperties) {
        this(new OfflineNodeTaskCompiler(transferProperties));
    }

    private OfflineFlowYamlSupport(OfflineNodeTaskCompiler nodeTaskCompiler) {
        this.yaml = new FlowYamlCodec();
        this.nodeTaskCompiler = nodeTaskCompiler;
    }

    String buildEmptyFlowYaml(String flowId, String namespace) {
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("id", flowId);
        root.put("namespace", namespace);
        root.put("tasks", List.of());
        return yaml.dump(root);
    }

    FlowIdentity parseIdentity(String source) {
        Map<String, Object> root = yaml.loadRoot(source);
        return new FlowIdentity(yaml.requiredString(root, "namespace"), yaml.requiredString(root, "id"));
    }

    String readLabel(String source, String key) {
        Object value = yaml.asStringObjectMap(yaml.loadRoot(source).get("labels")).get(key);
        return value == null ? null : value.toString();
    }

    String buildDebugFlow(String source,
                          String debugNamespace,
                          String flowPath,
                          Long groupId,
                          Long requestedBy,
                          String branch,
                          String sourceRevision,
                          String mode,
                          List<String> selectedTaskIds) {
        return buildDebugFlow(source, debugNamespace, flowPath, groupId, requestedBy, branch,
                sourceRevision, mode, selectedTaskIds, Set.of());
    }

    String buildDebugFlow(String source,
                          String debugNamespace,
                          String flowPath,
                          Long groupId,
                          Long requestedBy,
                          String branch,
                          String sourceRevision,
                          String mode,
                          List<String> selectedTaskIds,
                          Set<String> parameterOverrideKeys) {
        Map<String, Object> root = yaml.loadRoot(source);
        root.put("namespace", debugNamespace);
        root.remove("triggers");
        stripDependencyGate(root);

        Map<String, Object> labels = new LinkedHashMap<>();
        labels.putAll(yaml.asStringObjectMap(root.get("labels")));
        labels.put("wbdataMode", "DEBUG");
        labels.put("wbdataFlowPath", flowPath);
        labels.put("wbdataGroupId", String.valueOf(groupId));
        labels.put("wbdataRequestedBy", String.valueOf(requestedBy));
        labels.put("wbdataBranch", branch);
        labels.put("wbdataDebugNamespace", debugNamespace);
        labels.put("wbdataSourceRevision", sourceRevision);
        labels.put("wbdataSelectedTaskIds", String.join("---", new LinkedHashSet<>(selectedTaskIds)));
        if (parameterOverrideKeys == null || parameterOverrideKeys.isEmpty()) {
            labels.remove("wbdataParameterOverrideKeys");
        } else {
            labels.put("wbdataParameterOverrideKeys", String.join("---", parameterOverrideKeys));
        }
        root.put("labels", labels);

        if (!"ALL".equalsIgnoreCase(mode) && !"SELECTED".equalsIgnoreCase(mode)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "执行模式不合法");
        }
        if ("SELECTED".equalsIgnoreCase(mode)) {
            Set<String> selected = new LinkedHashSet<>(selectedTaskIds);
            if (selected.isEmpty()) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "请选择要执行的节点");
            }
            applySelection(yaml.requireTasks(root), selected);
        }

        return yaml.dump(root);
    }

    String applyParameterSnapshotId(String source, String snapshotId) {
        Map<String, Object> root = yaml.loadRoot(source);
        Map<String, Object> labels = new LinkedHashMap<>();
        labels.putAll(yaml.asStringObjectMap(root.get("labels")));
        if (snapshotId == null || snapshotId.isBlank()) {
            labels.remove(ExecutionParameterSnapshotRegistry.LABEL_KEY);
        } else {
            labels.put(ExecutionParameterSnapshotRegistry.LABEL_KEY, snapshotId);
        }
        if (labels.isEmpty()) {
            root.remove("labels");
        } else {
            root.put("labels", labels);
        }
        return yaml.dump(root);
    }

    String applyRuntimeTimezoneLabel(String source, String runtimeTimezone) {
        if (runtimeTimezone == null || runtimeTimezone.isBlank()) {
            return source;
        }
        Map<String, Object> root = yaml.loadRoot(source);
        Map<String, Object> labels = new LinkedHashMap<>();
        labels.putAll(yaml.asStringObjectMap(root.get("labels")));
        labels.put("wbdataRuntimeTimezone", runtimeTimezone.trim());
        root.put("labels", labels);
        return yaml.dump(root);
    }

    String sha256Hex(String content) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return java.util.HexFormat.of().formatHex(digest.digest(content.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("计算内容哈希失败", ex);
        }
    }

    ScheduleData readSchedule(String source) {
        Map<String, Object> root = yaml.loadRoot(source);
        Map<String, Object> trigger = findScheduleTrigger(root);
        if (trigger == null) {
            return null;
        }
        String cron = yaml.requiredString(trigger, "cron");
        return new ScheduleData(
                yaml.requiredString(trigger, "id"),
                cron,
                yaml.readOptionalString(trigger, "timezone"),
                !Boolean.TRUE.equals(trigger.get("disabled")),
                readPeriod(root, cron)
        );
    }

    private OfflineSchedulePeriod readPeriod(Map<String, Object> root, String cron) {
        String label = readLabelValue(root, SCHEDULE_PERIOD_LABEL);
        if (label != null) {
            try {
                return OfflineSchedulePeriod.valueOf(label.trim().toUpperCase());
            } catch (IllegalArgumentException ignored) {
                // 未知 label 值按未设置处理，回退到 cron 推断
            }
        }
        return inferPeriodFromCron(cron);
    }

    static OfflineSchedulePeriod inferPeriodFromCron(String cron) {
        if (cron == null) {
            return OfflineSchedulePeriod.CUSTOM;
        }
        String[] parts = cron.trim().split("\\s+");
        if (parts.length != 5) {
            return OfflineSchedulePeriod.CUSTOM;
        }
        if (isFixedNumber(parts[0]) && "*".equals(parts[1]) && "*".equals(parts[2])
                && "*".equals(parts[3]) && "*".equals(parts[4])) {
            return OfflineSchedulePeriod.HOURLY;
        }
        if (isFixedNumber(parts[0]) && isFixedNumber(parts[1]) && "*".equals(parts[2])
                && "*".equals(parts[3]) && "*".equals(parts[4])) {
            return OfflineSchedulePeriod.DAILY;
        }
        if (isFixedNumber(parts[0]) && isFixedNumber(parts[1]) && isFixedNumber(parts[2])
                && "*".equals(parts[3]) && "*".equals(parts[4])) {
            return OfflineSchedulePeriod.MONTHLY;
        }
        if (isFixedNumber(parts[0]) && isFixedNumber(parts[1]) && "*".equals(parts[2])
                && "*".equals(parts[3]) && isFixedNumber(parts[4])) {
            return OfflineSchedulePeriod.WEEKLY;
        }
        if (isFixedNumber(parts[0]) && isFixedNumber(parts[1]) && isFixedNumber(parts[2])
                && isFixedNumber(parts[3]) && "*".equals(parts[4])) {
            return OfflineSchedulePeriod.YEARLY;
        }
        return OfflineSchedulePeriod.CUSTOM;
    }

    private static boolean isFixedNumber(String field) {
        return field.matches("\\d{1,2}");
    }

    private String readLabelValue(Map<String, Object> root, String key) {
        Object value = yaml.asStringObjectMap(root.get("labels")).get(key);
        return value == null ? null : value.toString();
    }

    String updateSchedule(String source, String cron, String timezone, OfflineSchedulePeriod period) {
        return applySchedule(source, new OfflineFlowSchedule(cron, timezone, true, period));
    }

    String updateScheduleStatus(String source, boolean enabled) {
        Map<String, Object> root = yaml.loadRoot(source);
        Map<String, Object> trigger = findScheduleTrigger(root);
        if (trigger == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "任务尚未配置调度");
        }
        if (enabled) {
            trigger.remove("disabled");
        } else {
            trigger.put("disabled", true);
        }
        return yaml.dump(root);
    }

    String applySchedule(String source, OfflineFlowSchedule schedule) {
        if (schedule == null) {
            return source;
        }
        if (schedule.cron() == null || schedule.cron().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Cron 表达式不能为空");
        }
        if (schedule.period() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "调度频率不能为空");
        }

        Map<String, Object> root = yaml.loadRoot(source);
        Map<String, Object> trigger = findScheduleTrigger(root);
        if (trigger == null) {
            trigger = new LinkedHashMap<>();
            trigger.put("id", "schedule");
            trigger.put("type", "io.kestra.plugin.core.trigger.Schedule");
            yaml.ensureTriggers(root).add(trigger);
        }

        trigger.put("cron", schedule.cron());
        if (schedule.timezone() == null || schedule.timezone().isBlank()) {
            trigger.remove("timezone");
        } else {
            trigger.put("timezone", schedule.timezone());
        }
        trigger.put("recoverMissedSchedules", RECOVER_MISSED_SCHEDULES_NONE);
        if (schedule.enabled()) {
            trigger.remove("disabled");
        } else {
            trigger.put("disabled", true);
        }

        Map<String, Object> labels = new LinkedHashMap<>();
        labels.putAll(yaml.asStringObjectMap(root.get("labels")));
        labels.put(SCHEDULE_PERIOD_LABEL, schedule.period().name());
        root.put("labels", labels);
        return applyDependencyGate(yaml.dump(root));
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

    /**
     * 依赖闸门段（WaitUpstream task + 旁路/计划时间 input）的统一重生成。
     * 内容完全由 YAML 自身推导（namespace 的 pg-N、依赖/策略 labels、调度 trigger），
     * 因此所有改动调度或依赖的编译路径在收尾时调用一次即可保持闸门一致；无依赖时自动剥除。
     */
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

        ScheduleData schedule = readSchedule(source);
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
    private void stripDependencyGate(Map<String, Object> root) {
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

    List<String> collectNamespaceFiles(String source) {
        Map<String, Object> root = yaml.loadRoot(source);
        Set<String> files = new LinkedHashSet<>();
        collectNamespaceFiles(yaml.requireTasks(root), files);
        return List.copyOf(files);
    }

    FlowDocument parseDocument(String source) {
        Map<String, Object> root = yaml.loadRoot(source);
        return new FlowDocument(
                yaml.requiredString(root, "id"),
                yaml.requiredString(root, "namespace"),
                parseStages(yaml.requireTasks(root))
        );
    }

    FlowGraph parseGraph(String source) {
        Map<String, Object> root = yaml.loadRoot(source);
        List<Map<String, Object>> tasks = yaml.requireTasks(root);
        List<OfflineFlowNode> nodes = new ArrayList<>();
        List<FlowEdge> edges = new ArrayList<>();
        parseGraphTasks(tasks, nodes, edges);
        return new FlowGraph(
                yaml.requiredString(root, "id"),
                yaml.requiredString(root, "namespace"),
                nodes,
                edges
        );
    }

    private void parseGraphTasks(List<Map<String, Object>> tasks,
                                 List<OfflineFlowNode> outNodes,
                                 List<FlowEdge> outEdges) {
        for (Map<String, Object> task : tasks) {
            if (GATE_TASK_ID.equals(yaml.readOptionalString(task, "id"))) {
                // 依赖闸门是基础设施 task，不是画布节点
                continue;
            }
            if (yaml.isDagTask(task)) {
                // Dag: read tasks and their dependsOn
                List<Map<String, Object>> childTasks = yaml.castTaskList((List<?>) task.get("tasks"));
                for (Map<String, Object> dagTaskEntry : childTasks) {
                    Map<String, Object> actualTask = (Map<String, Object>) dagTaskEntry.get("task");
                    if (actualTask == null) continue;
                    OfflineFlowNode childNode = parseLeafNode(actualTask);
                    outNodes.add(childNode);
                    
                    Object dependsOn = dagTaskEntry.get("dependsOn");
                    if (dependsOn instanceof List<?> predIds) {
                        for (Object predId : predIds) {
                            outEdges.add(new FlowEdge(predId.toString(), childNode.taskId()));
                        }
                    }
                }
            } else {
                // Simple task (e.g. single node flow without Dag wrapper)
                outNodes.add(parseLeafNode(task));
            }
        }
    }

    /**
     * Compile a DAG (nodes + edges) back into a Kestra-compatible tasks list YAML.
     * Algorithm:
     * 1. Topological sort the nodes
     * 2. Group consecutive nodes that share identical predecessor sets AND successor sets → Parallel
     * 3. Single nodes become plain tasks
     */
    String compileGraph(String existingSource,
                        List<OfflineFlowNode> nodes,
                        List<FlowEdge> edges,
                        java.util.Map<Long, com.wbdata.datasource.entity.DataSource> dataSourceMap) {
        return compileGraph(existingSource, nodes, edges, dataSourceMap, null);
    }

    String compileGraph(String existingSource,
                        List<OfflineFlowNode> nodes,
                        List<FlowEdge> edges,
                        java.util.Map<Long, com.wbdata.datasource.entity.DataSource> dataSourceMap,
                        FlowParameterCompiler.Compilation parameterCompilation) {
        if (!isAcyclicGraph(nodes, edges)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "DAG 中存在环，请修正连线");
        }

        Map<String, Object> root = yaml.loadRoot(existingSource);
        if (parameterCompilation != null) {
            if (parameterCompilation.inputs().isEmpty()) {
                root.remove("inputs");
            } else {
                root.put("inputs", parameterCompilation.inputs());
            }
        }

        // Build adjacency maps
        Map<String, Set<String>> successors = new LinkedHashMap<>();
        Map<String, Set<String>> predecessors = new LinkedHashMap<>();
        for (OfflineFlowNode n : nodes) {
            successors.put(n.taskId(), new LinkedHashSet<>());
            predecessors.put(n.taskId(), new LinkedHashSet<>());
        }
        for (FlowEdge e : edges) {
            successors.get(e.source()).add(e.target());
            predecessors.get(e.target()).add(e.source());
        }

        // Topological sort (Kahn's algorithm)
        List<String> sorted = new ArrayList<>();
        Map<String, Integer> inDegree = new LinkedHashMap<>();
        for (OfflineFlowNode n : nodes) {
            inDegree.put(n.taskId(), predecessors.get(n.taskId()).size());
        }
        java.util.Queue<String> queue = new java.util.ArrayDeque<>();
        for (Map.Entry<String, Integer> entry : inDegree.entrySet()) {
            if (entry.getValue() == 0) queue.add(entry.getKey());
        }
        while (!queue.isEmpty()) {
            String current = queue.poll();
            sorted.add(current);
            for (String succ : successors.get(current)) {
                int newDeg = inDegree.get(succ) - 1;
                inDegree.put(succ, newDeg);
                if (newDeg == 0) queue.add(succ);
            }
        }

        // Build task map for looking up existing task definitions
        Map<String, Map<String, Object>> existingTaskMap = buildExistingTaskMap(yaml.requireTasks(root));

        // Build compiled tasks list
        List<Map<String, Object>> compiledTasks = new ArrayList<>();
        Map<String, Object> dagTask = new LinkedHashMap<>();
        dagTask.put("id", "flow_dag");
        dagTask.put("type", "io.kestra.plugin.core.flow.Dag");

        List<Map<String, Object>> childTasks = new ArrayList<>();
        for (String taskId : sorted) {
            Map<String, Object> taskDef = getOrCreateTaskDef(
                    existingTaskMap, taskId, nodes, dataSourceMap, parameterCompilation);
            
            // Wrap in DagTask
            Map<String, Object> dagTaskEntry = new LinkedHashMap<>();
            dagTaskEntry.put("task", taskDef);

            // Add dependsOn based on predecessors
            Set<String> preds = predecessors.get(taskId);
            if (preds != null && !preds.isEmpty()) {
                dagTaskEntry.put("dependsOn", new ArrayList<>(preds));
            }
            childTasks.add(dagTaskEntry);
        }
        
        dagTask.put("tasks", childTasks);
        compiledTasks.add(dagTask);

        root.put("tasks", compiledTasks);
        return applyDependencyGate(yaml.dump(root));
    }

    @SuppressWarnings("unchecked")
    private Map<String, Map<String, Object>> buildExistingTaskMap(List<Map<String, Object>> tasks) {
        Map<String, Map<String, Object>> result = new LinkedHashMap<>();
        for (Map<String, Object> task : tasks) {
            String id = yaml.readOptionalString(task, "id");
            if (id != null) {
                if (yaml.isDagTask(task)) {
                    Object childTasks = task.get("tasks");
                    if (childTasks instanceof List<?> rawChildren) {
                        List<Map<String, Object>> unmarshalledChildren = new ArrayList<>();
                        for (Map<String, Object> wrapper : yaml.castTaskList(rawChildren)) {
                            Object innerTask = wrapper.get("task");
                            if (innerTask instanceof Map<?, ?> inner) {
                                unmarshalledChildren.add((Map<String, Object>) inner);
                            }
                        }
                        result.putAll(buildExistingTaskMap(unmarshalledChildren));
                    }
                } else {
                    result.put(id, task);
                }
            }
        }
        return result;
    }

    private Map<String, Object> getOrCreateTaskDef(Map<String, Map<String, Object>> existingTaskMap,
                                                   String taskId,
                                                   List<OfflineFlowNode> nodes,
                                                   Map<Long, com.wbdata.datasource.entity.DataSource> dataSourceMap,
                                                   FlowParameterCompiler.Compilation parameterCompilation) {
        Map<String, Object> existing = existingTaskMap.get(taskId);
        OfflineFlowNode nodeInfo = nodes.stream()
                .filter(n -> n.taskId().equals(taskId))
                .findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "未知节点: " + taskId));
        if (parameterCompilation == null) {
            return nodeTaskCompiler.compile(existing, nodeInfo, dataSourceMap);
        }
        return nodeTaskCompiler.compile(
                existing,
                nodeInfo,
                dataSourceMap,
                parameterCompilation.parametersForTask(taskId),
                true
        );
    }

    private String readSqlReadPath(Map<String, Object> task) {
        String sql = yaml.readOptionalString(task, "sql");
        if (sql == null || sql.isBlank()) {
            return null;
        }
        java.util.regex.Matcher matcher = READ_CALL_PATTERN.matcher(sql);
        if (matcher.find()) {
            return matcher.group(1);
        }
        return null;
    }

    boolean isAcyclicGraph(List<OfflineFlowNode> nodes, List<FlowEdge> edges) {
        Map<String, Set<String>> adj = new LinkedHashMap<>();
        for (OfflineFlowNode n : nodes) adj.put(n.taskId(), new LinkedHashSet<>());
        for (FlowEdge e : edges) adj.get(e.source()).add(e.target());

        Set<String> visited = new LinkedHashSet<>();
        Set<String> onStack = new LinkedHashSet<>();

        for (OfflineFlowNode n : nodes) {
            if (!visited.contains(n.taskId())) {
                if (hasCycleDfs(n.taskId(), adj, visited, onStack)) return false;
            }
        }
        return true;
    }

    private boolean hasCycleDfs(String node, Map<String, Set<String>> adj,
                                Set<String> visited, Set<String> onStack) {
        visited.add(node);
        onStack.add(node);
        for (String neighbor : adj.getOrDefault(node, Set.of())) {
            if (!visited.contains(neighbor)) {
                if (hasCycleDfs(neighbor, adj, visited, onStack)) return true;
            } else if (onStack.contains(neighbor)) {
                return true;
            }
        }
        onStack.remove(node);
        return false;
    }

    private void collectNamespaceFiles(List<Map<String, Object>> tasks, Set<String> files) {
        for (Map<String, Object> task : tasks) {
            Map<String, Object> actualTask = task;
            Object wrappedTask = task.get("task");
            if (wrappedTask instanceof Map<?, ?> innerTask) {
                actualTask = (Map<String, Object>) innerTask;
            }
            files.addAll(readNamespaceIncludePathsFromTask(actualTask));
            Object childTasks = actualTask.get("tasks");
            if (childTasks instanceof List<?> rawChildTasks && !rawChildTasks.isEmpty()) {
                collectNamespaceFiles(yaml.castTaskList(rawChildTasks), files);
            }
        }
    }

    private boolean applySelection(List<Map<String, Object>> tasks, Set<String> selectedTaskIds) {
        boolean subtreeSelected = false;
        for (Map<String, Object> task : tasks) {
            boolean selected = selectedTaskIds.contains(yaml.requiredString(task, "id"));
            boolean descendantSelected = false;
            Object childTasks = task.get("tasks");
            if (childTasks instanceof List<?> rawChildTasks && !rawChildTasks.isEmpty()) {
                if (yaml.isDagTask(task)) {
                    List<Map<String, Object>> dagChildren = yaml.castTaskList(rawChildTasks);
                    List<Map<String, Object>> unwrappedChildren = new ArrayList<>();
                    for (Map<String, Object> wrapper : dagChildren) {
                        Object innerTask = wrapper.get("task");
                        if (innerTask instanceof Map<?, ?> inner) {
                            unwrappedChildren.add((Map<String, Object>) inner);
                        }
                    }
                    descendantSelected = applySelection(unwrappedChildren, selectedTaskIds);
                    pruneDagDependencies(dagChildren);
                } else {
                    descendantSelected = applySelection(yaml.castTaskList(rawChildTasks), selectedTaskIds);
                }
            }

            boolean keepEnabled = selected || descendantSelected;
            // For Dag containers, we keep them enabled if any descendant is selected
            if (yaml.isDagTask(task)) {
                if (!descendantSelected) {
                    task.put("disabled", true);
                }
            } else if (!selected) {
                task.put("disabled", true);
            }
            subtreeSelected = subtreeSelected || keepEnabled;
        }
        return subtreeSelected;
    }

    @SuppressWarnings("unchecked")
    private void pruneDagDependencies(List<Map<String, Object>> dagTasks) {
        Set<String> enabledTaskIds = new LinkedHashSet<>();
        for (Map<String, Object> wrapper : dagTasks) {
            Object innerTask = wrapper.get("task");
            if (innerTask instanceof Map<?, ?> inner && !Boolean.TRUE.equals(inner.get("disabled"))) {
                enabledTaskIds.add(yaml.requiredString((Map<String, Object>) inner, "id"));
            }
        }

        for (Map<String, Object> wrapper : dagTasks) {
            Object dependsOn = wrapper.get("dependsOn");
            if (!(dependsOn instanceof List<?> dependencies)) {
                continue;
            }
            List<String> retained = dependencies.stream()
                    .filter(String.class::isInstance)
                    .map(String.class::cast)
                    .filter(enabledTaskIds::contains)
                    .toList();
            if (retained.isEmpty()) {
                wrapper.remove("dependsOn");
            } else {
                wrapper.put("dependsOn", retained);
            }
        }
    }

    private Map<String, Object> findScheduleTrigger(Map<String, Object> root) {
        for (Map<String, Object> trigger : yaml.ensureTriggers(root)) {
            if ("io.kestra.plugin.core.trigger.Schedule".equals(yaml.readOptionalString(trigger, "type"))) {
                return trigger;
            }
        }
        return null;
    }

    private List<FlowStage> parseStages(List<Map<String, Object>> tasks) {
        List<FlowStage> stages = new ArrayList<>();
        for (Map<String, Object> task : tasks) {
            if (GATE_TASK_ID.equals(yaml.readOptionalString(task, "id"))) {
                // 依赖闸门是基础设施 task，不是画布节点
                continue;
            }
            if (yaml.isDagTask(task)) {
                Object rawChildTasks = task.get("tasks");
                if (rawChildTasks instanceof List<?> childTasks && !childTasks.isEmpty()) {
                    List<OfflineFlowNode> unwrappedNodes = new ArrayList<>();
                    for (Map<String, Object> wrapper : yaml.castTaskList(childTasks)) {
                        Object innerTask = wrapper.get("task");
                        if (innerTask instanceof Map<?, ?> inner) {
                            unwrappedNodes.add(parseLeafNode((Map<String, Object>) inner));
                        }
                    }
                    stages.add(new FlowStage(
                            "main_stage",
                            false,
                            unwrappedNodes
                    ));
                }
            } else {
                stages.add(new FlowStage(yaml.requiredString(task, "id"), false, List.of(parseLeafNode(task))));
            }
        }
        return stages;
    }

    private OfflineFlowNode parseLeafNode(Map<String, Object> task) {
        String taskId = yaml.requiredString(task, "id");
        OfflineTaskMetadataCodec.ParsedTaskMetadata metadata = OfflineTaskMetadataCodec.parse(
                yaml.readOptionalString(task, "description")
        );
        Long dataSourceId = metadata.dataSourceId();
        String dataSourceType = metadata.dataSourceType();
        String nodeKind = metadata.nodeKind();
        String scriptPath = "TRANSFER".equalsIgnoreCase(nodeKind) ? null : readScriptPath(task);

        // Backward compatibility for older YAML that stored datasource metadata on labels.
        if (dataSourceId == null) {
            Object labels = task.get("labels");
            if (labels instanceof Map<?, ?> labelMap) {
                Object dsIdObj = labelMap.get("wbdataDataSourceId");
                if (dsIdObj != null) {
                    try {
                        dataSourceId = Long.parseLong(dsIdObj.toString());
                    } catch (NumberFormatException ignored) {
                        // ignore malformed historical metadata
                    }
                }
            }
        }

        // Infer kind and type
        String typeAttr = yaml.readOptionalString(task, "type");
        if (typeAttr != null) {
            if ((dataSourceType == null || dataSourceType.isBlank())
                    && OfflineNodeTaskCompiler.isJdbcQueryTaskType(typeAttr)) {
                String prefix = typeAttr.startsWith(OfflineNodeTaskCompiler.WB_DATA_JDBC_TASK_PREFIX)
                        ? OfflineNodeTaskCompiler.WB_DATA_JDBC_TASK_PREFIX
                        : OfflineNodeTaskCompiler.KESTRA_JDBC_TASK_PREFIX;
                dataSourceType = typeAttr.substring(prefix.length()).split("\\.")[0].toUpperCase();
                if ("GENERIC".equals(dataSourceType)) {
                    dataSourceType = "HIVE";
                }
            }
        }

        if (nodeKind == null || nodeKind.isBlank()) {
            if (scriptPath.endsWith(".hql")
                    || ("HIVE".equalsIgnoreCase(dataSourceType)
                    && OfflineNodeTaskCompiler.SHELL_COMMANDS_TASK_TYPE.equals(typeAttr))) {
                nodeKind = "HIVE_SQL";
            } else {
                nodeKind = scriptPath.endsWith(".sql") ? "SQL" : "SHELL";
            }
        }
        nodeKind = OfflineFlowNodeKinds.canonicalize(nodeKind, dataSourceType);

        return new OfflineFlowNode(
                taskId,
                nodeKind,
                scriptPath,
                dataSourceId,
                dataSourceType,
                metadata.transferConfigPath()
        );
    }

    @SuppressWarnings("unchecked")
    private String readScriptPath(Map<String, Object> task) {
        List<String> includePaths = readNamespaceIncludePathsFromTask(task);
        if (includePaths.isEmpty()) {
            throw unsupportedTask("当前仅支持带脚本文件的 SQL / HiveSQL / Shell 节点");
        }
        return includePaths.getFirst();
    }


    @SuppressWarnings("unchecked")
    private List<String> readNamespaceIncludePathsFromTask(Map<String, Object> task) {
        LinkedHashSet<String> paths = new LinkedHashSet<>();

        Object namespaceFiles = task.get("namespaceFiles");
        if (namespaceFiles instanceof Map<?, ?> rawNamespaceFiles) {
            paths.addAll(readNamespaceIncludePathsFromConfig((Map<String, Object>) rawNamespaceFiles));
        }

        String sqlPath = readSqlReadPath(task);
        if (sqlPath != null) {
            paths.add(sqlPath);
        }

        return List.copyOf(paths);
    }

    private List<String> readNamespaceIncludePathsFromConfig(Map<String, Object> namespaceFiles) {
        Object include = namespaceFiles.get("include");
        if (!(include instanceof List<?> rawInclude) || rawInclude.isEmpty()) {
            return Collections.emptyList();
        }

        List<String> paths = new ArrayList<>();
        for (Object item : rawInclude) {
            if (item instanceof String scriptPath && !scriptPath.isBlank()) {
                paths.add(scriptPath);
            }
        }
        return paths;
    }

    private ResponseStatusException unsupportedTask(String reason) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, reason);
    }

    record FlowIdentity(String namespace, String flowId) {
    }

    record FlowDocument(
            String flowId,
            String namespace,
            List<FlowStage> stages
    ) {
    }

    record FlowStage(
            String stageId,
            boolean parallel,
            List<OfflineFlowNode> nodes
    ) {
    }

    record FlowEdge(
            String source,
            String target
    ) {
    }

    record FlowGraph(
            String flowId,
            String namespace,
            List<OfflineFlowNode> nodes,
            List<FlowEdge> edges
    ) {
    }

    record ScheduleData(
            String triggerId,
            String cron,
            String timezone,
            boolean enabled,
            OfflineSchedulePeriod period
    ) {
    }

}
