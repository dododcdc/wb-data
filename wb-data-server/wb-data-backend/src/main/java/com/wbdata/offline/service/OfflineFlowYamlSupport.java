package com.wbdata.offline.service;

import com.wbdata.offline.config.OfflineTransferProperties;
import com.wbdata.offline.dto.OfflineFlowSchedule;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import org.yaml.snakeyaml.DumperOptions;
import org.yaml.snakeyaml.Yaml;

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
    private static final String RECOVER_MISSED_SCHEDULES_NONE = "NONE";
    private static final java.util.regex.Pattern READ_CALL_PATTERN =
            java.util.regex.Pattern.compile("\\{\\{\\s*read\\(\\s*['\"]([^'\"]+)['\"]\\s*\\)\\s*}}");

    private final Yaml yaml;
    private final OfflineNodeTaskCompiler nodeTaskCompiler;

    OfflineFlowYamlSupport() {
        this(new OfflineNodeTaskCompiler());
    }

    OfflineFlowYamlSupport(OfflineTransferProperties transferProperties) {
        this(new OfflineNodeTaskCompiler(transferProperties));
    }

    private OfflineFlowYamlSupport(OfflineNodeTaskCompiler nodeTaskCompiler) {
        DumperOptions options = new DumperOptions();
        options.setDefaultFlowStyle(DumperOptions.FlowStyle.BLOCK);
        options.setPrettyFlow(true);
        this.yaml = new Yaml(options);
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
        Map<String, Object> root = loadRoot(source);
        return new FlowIdentity(requiredString(root, "namespace"), requiredString(root, "id"));
    }

    String readLabel(String source, String key) {
        Object value = asStringObjectMap(loadRoot(source).get("labels")).get(key);
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
        Map<String, Object> root = loadRoot(source);
        root.put("namespace", debugNamespace);
        root.remove("triggers");

        Map<String, Object> labels = new LinkedHashMap<>();
        labels.putAll(asStringObjectMap(root.get("labels")));
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
            applySelection(requireTasks(root), selected);
        }

        return yaml.dump(root);
    }

    String applyParameterSnapshotId(String source, String snapshotId) {
        Map<String, Object> root = loadRoot(source);
        Map<String, Object> labels = new LinkedHashMap<>();
        labels.putAll(asStringObjectMap(root.get("labels")));
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
        Map<String, Object> root = loadRoot(source);
        Map<String, Object> labels = new LinkedHashMap<>();
        labels.putAll(asStringObjectMap(root.get("labels")));
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
        Map<String, Object> root = loadRoot(source);
        Map<String, Object> trigger = findScheduleTrigger(root);
        if (trigger == null) {
            return null;
        }
        return new ScheduleData(
                requiredString(trigger, "id"),
                requiredString(trigger, "cron"),
                readOptionalString(trigger, "timezone"),
                !Boolean.TRUE.equals(trigger.get("disabled"))
        );
    }

    String updateSchedule(String source, String cron, String timezone) {
        return applySchedule(source, new OfflineFlowSchedule(cron, timezone, true));
    }

    String updateScheduleStatus(String source, boolean enabled) {
        Map<String, Object> root = loadRoot(source);
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

        Map<String, Object> root = loadRoot(source);
        Map<String, Object> trigger = findScheduleTrigger(root);
        if (trigger == null) {
            trigger = new LinkedHashMap<>();
            trigger.put("id", "schedule");
            trigger.put("type", "io.kestra.plugin.core.trigger.Schedule");
            ensureTriggers(root).add(trigger);
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
        return yaml.dump(root);
    }

    List<String> collectNamespaceFiles(String source) {
        Map<String, Object> root = loadRoot(source);
        Set<String> files = new LinkedHashSet<>();
        collectNamespaceFiles(requireTasks(root), files);
        return List.copyOf(files);
    }

    FlowDocument parseDocument(String source) {
        Map<String, Object> root = loadRoot(source);
        return new FlowDocument(
                requiredString(root, "id"),
                requiredString(root, "namespace"),
                parseStages(requireTasks(root))
        );
    }

    FlowGraph parseGraph(String source) {
        Map<String, Object> root = loadRoot(source);
        List<Map<String, Object>> tasks = requireTasks(root);
        List<OfflineFlowNode> nodes = new ArrayList<>();
        List<FlowEdge> edges = new ArrayList<>();
        parseGraphTasks(tasks, nodes, edges);
        return new FlowGraph(
                requiredString(root, "id"),
                requiredString(root, "namespace"),
                nodes,
                edges
        );
    }

    private void parseGraphTasks(List<Map<String, Object>> tasks,
                                 List<OfflineFlowNode> outNodes,
                                 List<FlowEdge> outEdges) {
        for (Map<String, Object> task : tasks) {
            if (isDagTask(task)) {
                // Dag: read tasks and their dependsOn
                List<Map<String, Object>> childTasks = castTaskList((List<?>) task.get("tasks"));
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

        Map<String, Object> root = loadRoot(existingSource);
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
        Map<String, Map<String, Object>> existingTaskMap = buildExistingTaskMap(requireTasks(root));

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
        return yaml.dump(root);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Map<String, Object>> buildExistingTaskMap(List<Map<String, Object>> tasks) {
        Map<String, Map<String, Object>> result = new LinkedHashMap<>();
        for (Map<String, Object> task : tasks) {
            String id = readOptionalString(task, "id");
            if (id != null) {
                if (isDagTask(task)) {
                    Object childTasks = task.get("tasks");
                    if (childTasks instanceof List<?> rawChildren) {
                        List<Map<String, Object>> unmarshalledChildren = new ArrayList<>();
                        for (Map<String, Object> wrapper : castTaskList(rawChildren)) {
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
        String sql = readOptionalString(task, "sql");
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

    @SuppressWarnings("unchecked")
    private Map<String, Object> loadRoot(String source) {
        Object loaded = yaml.load(source);
        if (!(loaded instanceof Map<?, ?> rawRoot)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Flow YAML 格式不合法");
        }
        return (Map<String, Object>) rawRoot;
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> requireTasks(Map<String, Object> root) {
        Object tasks = root.get("tasks");
        if (!(tasks instanceof List<?> rawTasks)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Flow YAML tasks 定义不合法");
        }
        if (rawTasks.isEmpty()) {
            return List.of();
        }
        List<Map<String, Object>> normalized = new ArrayList<>();
        for (Object rawTask : rawTasks) {
            if (!(rawTask instanceof Map<?, ?> taskMap)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Flow YAML tasks 定义不合法");
            }
            normalized.add((Map<String, Object>) taskMap);
        }
        return normalized;
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
                collectNamespaceFiles(castTaskList(rawChildTasks), files);
            }
        }
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> ensureTriggers(Map<String, Object> root) {
        Object triggers = root.get("triggers");
        if (triggers instanceof List<?> rawTriggers) {
            List<Map<String, Object>> normalized = new ArrayList<>();
            for (Object rawTrigger : rawTriggers) {
                if (!(rawTrigger instanceof Map<?, ?> triggerMap)) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Flow YAML triggers 定义不合法");
                }
                normalized.add((Map<String, Object>) triggerMap);
            }
            root.put("triggers", normalized);
            return normalized;
        }

        List<Map<String, Object>> created = new ArrayList<>();
        root.put("triggers", created);
        return created;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> asStringObjectMap(Object value) {
        if (value instanceof Map<?, ?> rawMap) {
            return (Map<String, Object>) rawMap;
        }
        return new LinkedHashMap<>();
    }

    private boolean applySelection(List<Map<String, Object>> tasks, Set<String> selectedTaskIds) {
        boolean subtreeSelected = false;
        for (Map<String, Object> task : tasks) {
            boolean selected = selectedTaskIds.contains(requiredString(task, "id"));
            boolean descendantSelected = false;
            Object childTasks = task.get("tasks");
            if (childTasks instanceof List<?> rawChildTasks && !rawChildTasks.isEmpty()) {
                if (isDagTask(task)) {
                    List<Map<String, Object>> dagChildren = castTaskList(rawChildTasks);
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
                    descendantSelected = applySelection(castTaskList(rawChildTasks), selectedTaskIds);
                }
            }

            boolean keepEnabled = selected || descendantSelected;
            // For Dag containers, we keep them enabled if any descendant is selected
            if (isDagTask(task)) {
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
                enabledTaskIds.add(requiredString((Map<String, Object>) inner, "id"));
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
        for (Map<String, Object> trigger : ensureTriggers(root)) {
            if ("io.kestra.plugin.core.trigger.Schedule".equals(readOptionalString(trigger, "type"))) {
                return trigger;
            }
        }
        return null;
    }

    private List<FlowStage> parseStages(List<Map<String, Object>> tasks) {
        List<FlowStage> stages = new ArrayList<>();
        for (Map<String, Object> task : tasks) {
            if (isDagTask(task)) {
                Object rawChildTasks = task.get("tasks");
                if (rawChildTasks instanceof List<?> childTasks && !childTasks.isEmpty()) {
                    List<OfflineFlowNode> unwrappedNodes = new ArrayList<>();
                    for (Map<String, Object> wrapper : castTaskList(childTasks)) {
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
                stages.add(new FlowStage(requiredString(task, "id"), false, List.of(parseLeafNode(task))));
            }
        }
        return stages;
    }

    private OfflineFlowNode parseLeafNode(Map<String, Object> task) {
        String taskId = requiredString(task, "id");
        OfflineTaskMetadataCodec.ParsedTaskMetadata metadata = OfflineTaskMetadataCodec.parse(
                readOptionalString(task, "description")
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
        String typeAttr = readOptionalString(task, "type");
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


    private boolean isDagTask(Map<String, Object> task) {
        return "io.kestra.plugin.core.flow.Dag".equals(readOptionalString(task, "type"));
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

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> castTaskList(List<?> rawChildTasks) {
        List<Map<String, Object>> childTasks = new ArrayList<>();
        for (Object rawTask : rawChildTasks) {
            if (!(rawTask instanceof Map<?, ?> taskMap)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Flow YAML tasks 定义不合法");
            }
            childTasks.add((Map<String, Object>) taskMap);
        }
        return childTasks;
    }

    private String requiredString(Map<String, Object> root, String key) {
        Object value = root.get(key);
        if (value instanceof String text && !text.isBlank()) {
            return text;
        }
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Flow YAML 缺少字段: " + key);
    }

    private String readOptionalString(Map<String, Object> root, String key) {
        Object value = root.get(key);
        return value instanceof String text && !text.isBlank() ? text : null;
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
            boolean enabled
    ) {
    }

}
