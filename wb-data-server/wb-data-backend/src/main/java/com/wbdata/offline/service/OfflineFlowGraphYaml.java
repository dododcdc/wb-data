package com.wbdata.offline.service;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 画布图模型（nodes + edges）与 Kestra tasks YAML 的双向转换，
 * 以及节点引用的 namespace 文件（脚本 / 传输配置）收集。
 * compileGraph 收尾统一重生成依赖闸门，保持「图编译 → 闸门」链式不变量。
 */
final class OfflineFlowGraphYaml {

    private static final java.util.regex.Pattern READ_CALL_PATTERN =
            java.util.regex.Pattern.compile("\\{\\{\\s*read\\(\\s*['\"]([^'\"]+)['\"]\\s*\\)\\s*}}");

    private final FlowYamlCodec yaml;
    private final OfflineFlowDependencyYaml dependencyYaml;
    private final OfflineNodeTaskCompiler nodeTaskCompiler;

    OfflineFlowGraphYaml(FlowYamlCodec yaml,
                         OfflineFlowDependencyYaml dependencyYaml,
                         OfflineNodeTaskCompiler nodeTaskCompiler) {
        this.yaml = yaml;
        this.dependencyYaml = dependencyYaml;
        this.nodeTaskCompiler = nodeTaskCompiler;
    }

    List<String> collectNamespaceFiles(String source) {
        Map<String, Object> root = yaml.loadRoot(source);
        Set<String> files = new LinkedHashSet<>();
        collectNamespaceFiles(yaml.requireTasks(root), files);
        return List.copyOf(files);
    }

    OfflineFlowYamlSupport.FlowDocument parseDocument(String source) {
        Map<String, Object> root = yaml.loadRoot(source);
        return new OfflineFlowYamlSupport.FlowDocument(
                yaml.requiredString(root, "id"),
                yaml.requiredString(root, "namespace"),
                parseStages(yaml.requireTasks(root))
        );
    }

    OfflineFlowYamlSupport.FlowGraph parseGraph(String source) {
        Map<String, Object> root = yaml.loadRoot(source);
        List<Map<String, Object>> tasks = yaml.requireTasks(root);
        List<OfflineFlowNode> nodes = new ArrayList<>();
        List<OfflineFlowYamlSupport.FlowEdge> edges = new ArrayList<>();
        parseGraphTasks(tasks, nodes, edges);
        return new OfflineFlowYamlSupport.FlowGraph(
                yaml.requiredString(root, "id"),
                yaml.requiredString(root, "namespace"),
                nodes,
                edges
        );
    }

    private void parseGraphTasks(List<Map<String, Object>> tasks,
                                 List<OfflineFlowNode> outNodes,
                                 List<OfflineFlowYamlSupport.FlowEdge> outEdges) {
        for (Map<String, Object> task : tasks) {
            if (OfflineFlowDependencyYaml.GATE_TASK_ID.equals(yaml.readOptionalString(task, "id"))) {
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
                            outEdges.add(new OfflineFlowYamlSupport.FlowEdge(predId.toString(), childNode.taskId()));
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
                        List<OfflineFlowYamlSupport.FlowEdge> edges,
                        java.util.Map<Long, com.wbdata.datasource.entity.DataSource> dataSourceMap) {
        return compileGraph(existingSource, nodes, edges, dataSourceMap, null);
    }

    String compileGraph(String existingSource,
                        List<OfflineFlowNode> nodes,
                        List<OfflineFlowYamlSupport.FlowEdge> edges,
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
        for (OfflineFlowYamlSupport.FlowEdge e : edges) {
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
        return dependencyYaml.applyDependencyGate(yaml.dump(root));
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

    boolean isAcyclicGraph(List<OfflineFlowNode> nodes, List<OfflineFlowYamlSupport.FlowEdge> edges) {
        Map<String, Set<String>> adj = new LinkedHashMap<>();
        for (OfflineFlowNode n : nodes) adj.put(n.taskId(), new LinkedHashSet<>());
        for (OfflineFlowYamlSupport.FlowEdge e : edges) adj.get(e.source()).add(e.target());

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

    private List<OfflineFlowYamlSupport.FlowStage> parseStages(List<Map<String, Object>> tasks) {
        List<OfflineFlowYamlSupport.FlowStage> stages = new ArrayList<>();
        for (Map<String, Object> task : tasks) {
            if (OfflineFlowDependencyYaml.GATE_TASK_ID.equals(yaml.readOptionalString(task, "id"))) {
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
                    stages.add(new OfflineFlowYamlSupport.FlowStage(
                            "main_stage",
                            false,
                            unwrappedNodes
                    ));
                }
            } else {
                stages.add(new OfflineFlowYamlSupport.FlowStage(
                        yaml.requiredString(task, "id"), false, List.of(parseLeafNode(task))));
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
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "当前仅支持带脚本文件的 SQL / HiveSQL / Shell 节点");
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
}
