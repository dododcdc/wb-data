package com.wbdata.offline.service;

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

    private final Yaml yaml;

    OfflineFlowYamlSupport() {
        DumperOptions options = new DumperOptions();
        options.setDefaultFlowStyle(DumperOptions.FlowStyle.BLOCK);
        options.setPrettyFlow(true);
        this.yaml = new Yaml(options);
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

    String buildDebugFlow(String source,
                          String debugNamespace,
                          String flowPath,
                          String sourceRevision,
                          String mode,
                          List<String> selectedTaskIds) {
        Map<String, Object> root = loadRoot(source);
        root.put("namespace", debugNamespace);
        root.remove("triggers");

        Map<String, Object> labels = new LinkedHashMap<>();
        labels.putAll(asStringObjectMap(root.get("labels")));
        labels.put("wbdataMode", "DEBUG");
        labels.put("wbdataFlowPath", flowPath);
        labels.put("wbdataSourceRevision", sourceRevision);
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
        Map<String, Object> root = loadRoot(source);
        Map<String, Object> trigger = findScheduleTrigger(root);
        if (trigger == null) {
            trigger = new LinkedHashMap<>();
            trigger.put("id", "schedule");
            trigger.put("type", "io.kestra.plugin.core.trigger.Schedule");
            ensureTriggers(root).add(trigger);
        }

        trigger.put("cron", cron);
        if (timezone == null || timezone.isBlank()) {
            trigger.remove("timezone");
        } else {
            trigger.put("timezone", timezone);
        }
        trigger.put("disabled", false);
        return yaml.dump(root);
    }

    String updateScheduleStatus(String source, boolean enabled) {
        Map<String, Object> root = loadRoot(source);
        Map<String, Object> trigger = findScheduleTrigger(root);
        if (trigger == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Flow 尚未配置调度");
        }
        if (enabled) {
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
        List<FlowNode> nodes = new ArrayList<>();
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
                                 List<FlowNode> outNodes,
                                 List<FlowEdge> outEdges) {
        // Track previous "exit" task IDs — these connect to the current task's "entry" IDs.
        List<String> previousExitIds = new ArrayList<>();

        for (Map<String, Object> task : tasks) {
            if (isParallelTask(task)) {
                // Parallel: entry nodes = all children, exit nodes = all children
                List<Map<String, Object>> childTasks = castTaskList((List<?>) task.get("tasks"));
                List<String> parallelEntryIds = new ArrayList<>();
                for (Map<String, Object> childTask : childTasks) {
                    FlowNode childNode = parseLeafNode(childTask);
                    outNodes.add(childNode);
                    parallelEntryIds.add(childNode.taskId());
                }
                // Connect previous exits → each parallel entry
                for (String prevId : previousExitIds) {
                    for (String entryId : parallelEntryIds) {
                        outEdges.add(new FlowEdge(prevId, entryId));
                    }
                }
                previousExitIds = new ArrayList<>(parallelEntryIds);
            } else {
                // Simple task: entry = itself, exit = itself
                FlowNode node = parseLeafNode(task);
                outNodes.add(node);
                for (String prevId : previousExitIds) {
                    outEdges.add(new FlowEdge(prevId, node.taskId()));
                }
                previousExitIds = List.of(node.taskId());
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
                        List<FlowNode> nodes,
                        List<FlowEdge> edges,
                        java.util.Map<Long, com.wbdata.datasource.entity.DataSource> dataSourceMap) {
        if (!isAcyclicGraph(nodes, edges)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "DAG 中存在环，请修正连线");
        }

        Map<String, Object> root = loadRoot(existingSource);

        // Build adjacency maps
        Map<String, Set<String>> successors = new LinkedHashMap<>();
        Map<String, Set<String>> predecessors = new LinkedHashMap<>();
        for (FlowNode n : nodes) {
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
        for (FlowNode n : nodes) {
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

        // Assign layers (longest path from any source)
        Map<String, Integer> layer = new LinkedHashMap<>();
        for (String id : sorted) {
            int maxPredLayer = -1;
            for (String pred : predecessors.get(id)) {
                maxPredLayer = Math.max(maxPredLayer, layer.getOrDefault(pred, 0));
            }
            layer.put(id, maxPredLayer + 1);
        }

        // Group by layer, preserving topological order within each layer
        Map<Integer, List<String>> layerGroups = new LinkedHashMap<>();
        for (String id : sorted) {
            layerGroups.computeIfAbsent(layer.get(id), k -> new ArrayList<>()).add(id);
        }

        // Build task map for looking up existing task definitions
        Map<String, Map<String, Object>> existingTaskMap = buildExistingTaskMap(requireTasks(root));

        // Build compiled tasks list
        List<Map<String, Object>> compiledTasks = new ArrayList<>();
        List<Integer> sortedLayers = new ArrayList<>(layerGroups.keySet());
        Collections.sort(sortedLayers);

        for (int layerIdx : sortedLayers) {
            List<String> groupIds = layerGroups.get(layerIdx);
            if (groupIds.size() == 1) {
                // Single task stage
                String taskId = groupIds.getFirst();
                compiledTasks.add(getOrCreateTaskDef(existingTaskMap, taskId, nodes, dataSourceMap));
            } else {
                // Parallel group
                Map<String, Object> parallelTask = new LinkedHashMap<>();
                parallelTask.put("id", "parallel_" + layerIdx);
                parallelTask.put("type", "io.kestra.plugin.core.flow.Parallel");
                List<Map<String, Object>> childDefs = new ArrayList<>();
                for (String taskId : groupIds) {
                    childDefs.add(getOrCreateTaskDef(existingTaskMap, taskId, nodes, dataSourceMap));
                }
                parallelTask.put("tasks", childDefs);
                compiledTasks.add(parallelTask);
            }
        }

        root.put("tasks", compiledTasks);
        return yaml.dump(root);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Map<String, Object>> buildExistingTaskMap(List<Map<String, Object>> tasks) {
        Map<String, Map<String, Object>> result = new LinkedHashMap<>();
        for (Map<String, Object> task : tasks) {
            String id = readOptionalString(task, "id");
            if (id != null) {
                if (isParallelTask(task)) {
                    Object childTasks = task.get("tasks");
                    if (childTasks instanceof List<?> rawChildren) {
                        result.putAll(buildExistingTaskMap(castTaskList(rawChildren)));
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
                                                   List<FlowNode> nodes,
                                                   Map<Long, com.wbdata.datasource.entity.DataSource> dataSourceMap) {
        Map<String, Object> existing = existingTaskMap.get(taskId);
        FlowNode nodeInfo = nodes.stream()
                .filter(n -> n.taskId().equals(taskId))
                .findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "未知节点: " + taskId));

        Map<String, Object> task;
        if (existing != null) {
            task = new LinkedHashMap<>(existing);
            task.remove("disabled");
        } else {
            task = new LinkedHashMap<>();
            task.put("id", taskId);
            // Default to shell if it's not SQL
            if (!"SQL".equalsIgnoreCase(nodeInfo.kind())) {
                task.put("type", "io.kestra.plugin.scripts.shell.Commands");
            }
        }

        // Apply Data Source configuration for SQL nodes
        if ("SQL".equalsIgnoreCase(nodeInfo.kind())) {
            applyDataSourceToTask(task, nodeInfo, dataSourceMap);
        } else {
            // Standard Shell configuration
            task.put("type", "io.kestra.plugin.scripts.shell.Commands");
            Map<String, Object> nsFiles = new LinkedHashMap<>();
            nsFiles.put("enabled", true);
            nsFiles.put("include", List.of(nodeInfo.scriptPath()));
            task.put("namespaceFiles", nsFiles);
            task.put("commands", List.of("bash " + nodeInfo.scriptPath()));
        }

        return task;
    }

    private void applyDataSourceToTask(Map<String, Object> task,
                                       FlowNode nodeInfo,
                                       Map<Long, com.wbdata.datasource.entity.DataSource> dataSourceMap) {
        Long dsId = nodeInfo.dataSourceId();
        com.wbdata.datasource.entity.DataSource ds = dsId != null ? dataSourceMap.get(dsId) : null;

        if (ds == null) {
            // Fallback to Shell if no data source is selected or found
            task.put("type", "io.kestra.plugin.scripts.shell.Commands");
            Map<String, Object> nsFiles = new LinkedHashMap<>();
            nsFiles.put("enabled", true);
            nsFiles.put("include", List.of(nodeInfo.scriptPath()));
            task.put("namespaceFiles", nsFiles);
            task.put("commands", List.of("cat " + nodeInfo.scriptPath() + " # No data source selected"));
            return;
        }

        String type = ds.getType().toUpperCase();
        String kestraType;
        Map<String, Object> labels = asStringObjectMap(task.get("labels"));
        labels.put("wbdataDataSourceId", ds.getId().toString());
        task.put("labels", labels);

        switch (type) {
            case "MYSQL", "STARROCKS" -> kestraType = "io.kestra.plugin.jdbc.mysql.Query";
            case "POSTGRESQL" -> kestraType = "io.kestra.plugin.jdbc.postgresql.Query";
            case "HIVE" -> {
                kestraType = "io.kestra.plugin.jdbc.generic.Query";
                task.put("driverClassName", "org.apache.hive.jdbc.HiveDriver");
            }
            default -> kestraType = "io.kestra.plugin.jdbc.generic.Query";
        }

        task.put("type", kestraType);
        task.put("url", String.format("jdbc:%s://%s:%d/%s", 
                type.toLowerCase().replace("starrocks", "mysql"), 
                ds.getHost(), ds.getPort(), ds.getDatabaseName()));
        task.put("username", ds.getUsername());
        task.put("password", ds.getPassword());
        task.put("sql", String.format("{{ read('%s') }}", nodeInfo.scriptPath()));
    }

    boolean isAcyclicGraph(List<FlowNode> nodes, List<FlowEdge> edges) {
        Map<String, Set<String>> adj = new LinkedHashMap<>();
        for (FlowNode n : nodes) adj.put(n.taskId(), new LinkedHashSet<>());
        for (FlowEdge e : edges) adj.get(e.source()).add(e.target());

        Set<String> visited = new LinkedHashSet<>();
        Set<String> onStack = new LinkedHashSet<>();

        for (FlowNode n : nodes) {
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
            files.addAll(readNamespaceIncludePathsFromTask(task));
            Object childTasks = task.get("tasks");
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
                descendantSelected = applySelection(castTaskList(rawChildTasks), selectedTaskIds);
            }

            boolean keepEnabled = selected || descendantSelected;
            if (!keepEnabled) {
                task.put("disabled", true);
            }
            subtreeSelected = subtreeSelected || keepEnabled;
        }
        return subtreeSelected;
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
            if (isParallelTask(task)) {
                Object rawChildTasks = task.get("tasks");
                if (!(rawChildTasks instanceof List<?> childTasks) || childTasks.isEmpty()) {
                    throw unsupportedTask("Parallel 任务缺少子节点");
                }
                stages.add(new FlowStage(
                        requiredString(task, "id"),
                        true,
                        castTaskList(childTasks).stream().map(this::parseLeafNode).toList()
                ));
            } else {
                stages.add(new FlowStage(requiredString(task, "id"), false, List.of(parseLeafNode(task))));
            }
        }
        return stages;
    }

    private FlowNode parseLeafNode(Map<String, Object> task) {
        if (isParallelTask(task)) {
            throw unsupportedTask("当前仅支持单层 Parallel 结构");
        }
        String taskId = requiredString(task, "id");
        String scriptPath = readScriptPath(task);
        
        Long dataSourceId = null;
        String dataSourceType = null;
        
        // Extract data source info from labels if present
        Object labels = task.get("labels");
        if (labels instanceof Map<?, ?> labelMap) {
            Object dsIdObj = labelMap.get("wbdataDataSourceId");
            if (dsIdObj != null) {
                try {
                    dataSourceId = Long.parseLong(dsIdObj.toString());
                } catch (NumberFormatException ignored) {}
            }
        }
        
        // Infer kind and type
        String typeAttr = readOptionalString(task, "type");
        if (typeAttr != null) {
            if (typeAttr.startsWith("io.kestra.plugin.jdbc.")) {
                dataSourceType = typeAttr.substring("io.kestra.plugin.jdbc.".length()).split("\\.")[0].toUpperCase();
                if ("GENERIC".equals(dataSourceType)) {
                    dataSourceType = "HIVE"; // Simplified assumption for our current design
                }
            }
        }

        return new FlowNode(
                taskId,
                scriptPath.endsWith(".sql") ? "SQL" : "SHELL",
                scriptPath,
                dataSourceId,
                dataSourceType
        );
    }

    @SuppressWarnings("unchecked")
    private String readScriptPath(Map<String, Object> task) {
        Object namespaceFiles = task.get("namespaceFiles");
        if (!(namespaceFiles instanceof Map<?, ?> rawNamespaceFiles)) {
            throw unsupportedTask("当前仅支持带脚本文件的 SQL / Shell 节点");
        }

        List<String> includePaths = readNamespaceIncludePathsFromConfig((Map<String, Object>) rawNamespaceFiles);
        if (includePaths.isEmpty()) {
            throw unsupportedTask("当前仅支持带脚本文件的 SQL / Shell 节点");
        }
        return includePaths.getFirst();
    }

    private boolean isParallelTask(Map<String, Object> task) {
        return "io.kestra.plugin.core.flow.Parallel".equals(readOptionalString(task, "type"));
    }

    @SuppressWarnings("unchecked")
    private List<String> readNamespaceIncludePathsFromTask(Map<String, Object> task) {
        Object namespaceFiles = task.get("namespaceFiles");
        if (!(namespaceFiles instanceof Map<?, ?> rawNamespaceFiles)) {
            return Collections.emptyList();
        }
        return readNamespaceIncludePathsFromConfig((Map<String, Object>) rawNamespaceFiles);
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
            List<FlowNode> nodes
    ) {
    }

    record FlowNode(
            String taskId,
            String kind,
            String scriptPath,
            Long dataSourceId,
            String dataSourceType
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
            List<FlowNode> nodes,
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
