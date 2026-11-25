package com.wbdata.operations.service;

import com.wbdata.offline.kestra.KestraExecutionSnapshot;
import com.wbdata.offline.kestra.KestraTaskRunSnapshot;
import com.wbdata.offline.service.OfflineFlowInspector;
import com.wbdata.operations.dto.OperationsExecutionRerunContextResponse;
import com.wbdata.operations.dto.OperationsRerunGraphEdge;
import com.wbdata.operations.dto.OperationsRerunGraphNode;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Queue;
import java.util.Set;

/**
 * 运维中心按节点重跑的图规划与选区校验：
 * <ul>
 *   <li>根据原执行节点状态与当前线上 DAG，计算默认选中/必选的“失败或未执行节点及其全部下游”闭包；</li>
 *   <li>校验用户提交的重跑节点集合是否满足必选集约束与路径凸性（无中间断层）。</li>
 * </ul>
 */
final class OperationsRerunGraphPlanner {

    static final String STATUS_NOT_RUN = "NOT_RUN";
    private static final String GATE_TASK_ID = OperationsInstanceDiagnosisService.GATE_TASK_ID;
    private static final String DAG_TASK_ID = "flow_dag";
    private static final String UNSUPPORTED_FALLBACK_REASON =
            "当前线上版本暂不支持按节点重跑，本次将重跑整个任务；在离线开发中重新保存、提交并同步后即可支持按节点选择重跑。";
    private static final String GRAPH_CHANGED_FALLBACK_REASON =
            "原执行之后任务节点结构已更新，已默认全选当前节点，请确认重跑范围。";

    private OperationsRerunGraphPlanner() {
    }

    static OperationsExecutionRerunContextResponse buildContext(KestraExecutionSnapshot original,
                                                                OfflineFlowInspector.InspectedGraph graph) {
        Map<String, String> taskStatusById = extractUserTaskStatuses(original);

        List<OfflineFlowInspector.InspectedNode> inspectedNodes = graph.nodes() == null ? List.of() : graph.nodes();
        List<OfflineFlowInspector.InspectedEdge> inspectedEdges = graph.edges() == null ? List.of() : graph.edges();

        Set<String> currentNodeIds = new LinkedHashSet<>();
        for (OfflineFlowInspector.InspectedNode node : inspectedNodes) {
            currentNodeIds.add(node.taskId());
        }
        boolean graphChanged = taskStatusById.keySet().stream()
                .anyMatch(taskId -> !currentNodeIds.contains(taskId));

        List<OperationsRerunGraphNode> nodes = new ArrayList<>(inspectedNodes.size());
        for (OfflineFlowInspector.InspectedNode node : inspectedNodes) {
            String status = taskStatusById.getOrDefault(node.taskId(), STATUS_NOT_RUN);
            nodes.add(new OperationsRerunGraphNode(node.taskId(), node.kind(), node.dataSourceType(), status));
        }

        List<OperationsRerunGraphEdge> edges = inspectedEdges.stream()
                .filter(edge -> currentNodeIds.contains(edge.source()) && currentNodeIds.contains(edge.target()))
                .map(edge -> new OperationsRerunGraphEdge(edge.source(), edge.target()))
                .toList();

        List<String> allNodeIds = nodes.stream().map(OperationsRerunGraphNode::taskId).toList();

        Set<String> seeds = new LinkedHashSet<>();
        for (OperationsRerunGraphNode node : nodes) {
            String status = node.executionStatus();
            if (!"SUCCESS".equalsIgnoreCase(status) && !"SKIPPED".equalsIgnoreCase(status)) {
                seeds.add(node.taskId());
            }
        }
        Map<String, List<String>> successors = buildAdjacency(allNodeIds, edges, true);
        Set<String> closureSet = bfs(seeds, successors);
        List<String> requiredClosure = allNodeIds.stream().filter(closureSet::contains).toList();

        List<String> defaultSelected;
        List<String> required;
        String fallbackReason;
        if (!graph.partialRerunSupported()) {
            defaultSelected = allNodeIds;
            required = allNodeIds;
            fallbackReason = allNodeIds.size() > 1 ? UNSUPPORTED_FALLBACK_REASON : null;
        } else if (graphChanged) {
            defaultSelected = allNodeIds;
            required = requiredClosure;
            fallbackReason = GRAPH_CHANGED_FALLBACK_REASON;
        } else if (seeds.isEmpty()) {
            defaultSelected = allNodeIds;
            required = allNodeIds;
            fallbackReason = null;
        } else {
            required = requiredClosure;
            defaultSelected = requiredClosure;
            fallbackReason = null;
        }

        return new OperationsExecutionRerunContextResponse(
                original.id(),
                graph.namespace(),
                graph.flowId(),
                graph.partialRerunSupported(),
                graphChanged,
                fallbackReason,
                List.copyOf(nodes),
                List.copyOf(edges),
                List.copyOf(defaultSelected),
                List.copyOf(required)
        );
    }

    static SelectionResolution resolveSelection(OperationsExecutionRerunContextResponse context,
                                                List<String> requestedTaskIds) {
        List<String> allNodeIds = context.nodes().stream().map(OperationsRerunGraphNode::taskId).toList();
        int totalNodeCount = allNodeIds.size();
        if (requestedTaskIds == null) {
            return new SelectionResolution(false, List.of(), totalNodeCount);
        }

        Set<String> selectedSet = new LinkedHashSet<>();
        for (String rawId : requestedTaskIds) {
            if (rawId != null && !rawId.isBlank()) {
                selectedSet.add(rawId.trim());
            }
        }
        if (selectedSet.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "请至少选择一个重跑节点");
        }

        Set<String> allNodeSet = new LinkedHashSet<>(allNodeIds);
        List<String> unknown = selectedSet.stream()
                .filter(id -> !allNodeSet.contains(id))
                .toList();
        if (!unknown.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "重跑节点不存在于当前任务中: " + String.join(", ", unknown));
        }

        if (!context.partialRerunSupported()) {
            if (selectedSet.size() == totalNodeCount) {
                return new SelectionResolution(false, allNodeIds, totalNodeCount);
            }
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "当前线上版本不支持按节点选择重跑，请重跑整个任务或重新同步该任务");
        }

        List<String> missingRequired = context.requiredTaskIds().stream()
                .filter(id -> !selectedSet.contains(id))
                .toList();
        if (!missingRequired.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "重跑范围必须包含失败/未执行节点及其全部下游: " + String.join(", ", missingRequired));
        }

        Map<String, List<String>> successors = buildAdjacency(allNodeIds, context.edges(), true);
        Map<String, List<String>> predecessors = buildAdjacency(allNodeIds, context.edges(), false);
        Set<String> descendants = bfs(selectedSet, successors);
        Set<String> ancestors = bfs(selectedSet, predecessors);
        List<String> gapNodes = allNodeIds.stream()
                .filter(id -> descendants.contains(id) && ancestors.contains(id) && !selectedSet.contains(id))
                .toList();
        if (!gapNodes.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "所选重跑节点之间存在未选中的中间节点，请一并勾选: " + String.join(", ", gapNodes));
        }

        List<String> orderedSelected = allNodeIds.stream()
                .filter(selectedSet::contains)
                .toList();
        if (orderedSelected.size() == totalNodeCount) {
            return new SelectionResolution(false, orderedSelected, totalNodeCount);
        }
        return new SelectionResolution(true, orderedSelected, totalNodeCount);
    }

    private static Map<String, String> extractUserTaskStatuses(KestraExecutionSnapshot original) {
        Map<String, String> statuses = new LinkedHashMap<>();
        if (original == null || original.taskRuns() == null) {
            return statuses;
        }
        for (KestraTaskRunSnapshot taskRun : original.taskRuns()) {
            if (taskRun == null) {
                continue;
            }
            String taskId = taskRun.taskId();
            if (taskId == null || taskId.isBlank()
                    || DAG_TASK_ID.equals(taskId)
                    || taskId.startsWith("parallel_")
                    || GATE_TASK_ID.equals(taskId)) {
                continue;
            }
            statuses.put(taskId, normalizeStatus(taskRun.status()));
        }
        return statuses;
    }

    private static String normalizeStatus(String status) {
        if (status == null || status.isBlank()) {
            return STATUS_NOT_RUN;
        }
        return status.trim().toUpperCase(Locale.ROOT);
    }

    private static Map<String, List<String>> buildAdjacency(List<String> allNodeIds,
                                                            List<OperationsRerunGraphEdge> edges,
                                                            boolean forward) {
        Map<String, List<String>> adjacency = new LinkedHashMap<>();
        for (String nodeId : allNodeIds) {
            adjacency.put(nodeId, new ArrayList<>());
        }
        for (OperationsRerunGraphEdge edge : edges) {
            String from = forward ? edge.source() : edge.target();
            String to = forward ? edge.target() : edge.source();
            List<String> neighbors = adjacency.get(from);
            if (neighbors != null) {
                neighbors.add(to);
            }
        }
        return adjacency;
    }

    private static Set<String> bfs(Set<String> seeds, Map<String, List<String>> adjacency) {
        Set<String> visited = new LinkedHashSet<>();
        Queue<String> queue = new ArrayDeque<>();
        for (String seed : seeds) {
            if (visited.add(seed)) {
                queue.add(seed);
            }
        }
        while (!queue.isEmpty()) {
            String current = queue.poll();
            for (String next : adjacency.getOrDefault(current, List.of())) {
                if (visited.add(next)) {
                    queue.add(next);
                }
            }
        }
        return visited;
    }

    record SelectionResolution(
            boolean partial,
            List<String> orderedSelectedTaskIds,
            int totalNodeCount
    ) {
    }
}
