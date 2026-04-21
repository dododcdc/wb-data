package com.wbdata.offline.service;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.util.*;

public class OfflineFlowGraphValidation {

    public void assertNoImplicitDependencies(List<OfflineFlowYamlSupport.FlowNode> nodes,
                                             List<OfflineFlowYamlSupport.FlowEdge> edges) {
        // Build node id list and maps
        Map<String, Set<String>> successors = new LinkedHashMap<>();
        Map<String, Set<String>> predecessors = new LinkedHashMap<>();
        for (OfflineFlowYamlSupport.FlowNode n : nodes) {
            successors.put(n.taskId(), new LinkedHashSet<>());
            predecessors.put(n.taskId(), new LinkedHashSet<>());
        }

        for (OfflineFlowYamlSupport.FlowEdge e : edges) {
            if (!successors.containsKey(e.source()) || !predecessors.containsKey(e.target())) {
                // ignore edges that reference unknown nodes
                continue;
            }
            successors.get(e.source()).add(e.target());
            predecessors.get(e.target()).add(e.source());
        }

        // Topological sort (Kahn)
        Map<String, Integer> inDegree = new LinkedHashMap<>();
        for (String id : predecessors.keySet()) {
            inDegree.put(id, predecessors.get(id).size());
        }
        Deque<String> queue = new ArrayDeque<>();
        for (Map.Entry<String, Integer> en : inDegree.entrySet()) {
            if (en.getValue() == 0) queue.add(en.getKey());
        }
        List<String> sorted = new ArrayList<>();
        while (!queue.isEmpty()) {
            String cur = queue.poll();
            sorted.add(cur);
            for (String succ : successors.getOrDefault(cur, Collections.emptySet())) {
                int d = inDegree.get(succ) - 1;
                inDegree.put(succ, d);
                if (d == 0) queue.add(succ);
            }
        }

        if (sorted.size() != successors.size()) {
            // cycle detected — let caller handle, but reject as bad request
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "DAG 中存在环，请修正连线");
        }

        // Assign layers (longest path from any source)
        Map<String, Integer> layer = new LinkedHashMap<>();
        for (String id : sorted) {
            int maxPredLayer = -1;
            for (String pred : predecessors.getOrDefault(id, Collections.emptySet())) {
                maxPredLayer = Math.max(maxPredLayer, layer.getOrDefault(pred, 0));
            }
            layer.put(id, maxPredLayer + 1);
        }

        // Group by layer preserving topological order
        Map<Integer, List<String>> layerGroups = new LinkedHashMap<>();
        for (String id : sorted) {
            int l = layer.get(id);
            layerGroups.computeIfAbsent(l, k -> new ArrayList<>()).add(id);
        }

        if (layerGroups.isEmpty()) return;

        int maxLayer = Collections.max(layerGroups.keySet());
        for (int i = 0; i < maxLayer; i++) {
            List<String> prev = layerGroups.getOrDefault(i, Collections.emptyList());
            List<String> next = layerGroups.getOrDefault(i + 1, Collections.emptyList());
            if (prev.isEmpty() || next.isEmpty()) continue;
            for (String u : prev) {
                for (String v : next) {
                    if (!successors.getOrDefault(u, Collections.emptySet()).contains(v)) {
                        throw new ResponseStatusException(
                                HttpStatus.BAD_REQUEST,
                                "当前 Flow 存在未明确配置的依赖关系，请先在画布中补全依赖线后再保存。"
                        );
                    }
                }
            }
        }
    }
}
