package com.wbdata.operations.service;

import com.wbdata.offline.kestra.KestraExecutionSnapshot;
import com.wbdata.offline.kestra.KestraTaskRunSnapshot;
import com.wbdata.offline.service.OfflineFlowInspector;
import com.wbdata.operations.dto.OperationsExecutionRerunContextResponse;
import com.wbdata.operations.dto.OperationsRerunGraphNode;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class OperationsRerunGraphPlannerTest {

    @Test
    void buildContext_locksFailedAndNotRunDownstream_keepsSucceededUpstreamOptional() {
        OfflineFlowInspector.InspectedGraph graph = diamondGraph(true);
        KestraExecutionSnapshot original = executionWithRuns(List.of(
                taskRun("node_a", "SUCCESS"),
                taskRun("node_b", "FAILED"),
                taskRun("node_c", "SUCCESS")
                // node_d not reached -> NOT_RUN
        ));

        OperationsExecutionRerunContextResponse context = OperationsRerunGraphPlanner.buildContext(original, graph);

        assertThat(context.partialRerunSupported()).isTrue();
        assertThat(context.graphChanged()).isFalse();
        assertThat(context.fallbackReason()).isNull();
        assertThat(context.nodes()).containsExactly(
                new OperationsRerunGraphNode("node_a", "MYSQL", "MYSQL", "SUCCESS"),
                new OperationsRerunGraphNode("node_b", "SHELL", null, "FAILED"),
                new OperationsRerunGraphNode("node_c", "SHELL", null, "SUCCESS"),
                new OperationsRerunGraphNode("node_d", "HIVE_SQL", "HIVE", "NOT_RUN")
        );
        assertThat(context.requiredTaskIds()).containsExactly("node_b", "node_d");
        assertThat(context.defaultSelectedTaskIds()).containsExactly("node_b", "node_d");
    }

    @Test
    void buildContext_treatsSkippedUpstreamOnPartialRerunFailureAsOptional() {
        OfflineFlowInspector.InspectedGraph graph = new OfflineFlowInspector.InspectedGraph(
                "daily",
                "g4-main",
                List.of(
                        node("extract", "MYSQL", "MYSQL"),
                        node("transform", "SHELL", null),
                        node("load", "TRANSFER", null)
                ),
                List.of(
                        new OfflineFlowInspector.InspectedEdge("extract", "transform"),
                        new OfflineFlowInspector.InspectedEdge("transform", "load")
                ),
                true
        );
        KestraExecutionSnapshot original = executionWithRuns(List.of(
                taskRun("extract", "SKIPPED"),
                taskRun("transform", "FAILED")
        ));

        OperationsExecutionRerunContextResponse context = OperationsRerunGraphPlanner.buildContext(original, graph);

        assertThat(context.requiredTaskIds()).containsExactly("transform", "load");
        assertThat(context.defaultSelectedTaskIds()).containsExactly("transform", "load");
    }

    @Test
    void buildContext_ignoresGateTaskRunAndLocksAllWhenGateFailed() {
        OfflineFlowInspector.InspectedGraph graph = diamondGraph(true);
        KestraExecutionSnapshot original = executionWithRuns(List.of(
                taskRun("wb_upstream_gate", "FAILED")
        ));

        OperationsExecutionRerunContextResponse context = OperationsRerunGraphPlanner.buildContext(original, graph);

        assertThat(context.graphChanged()).isFalse();
        assertThat(context.fallbackReason()).isNull();
        assertThat(context.requiredTaskIds()).containsExactly("node_a", "node_b", "node_c", "node_d");
        assertThat(context.defaultSelectedTaskIds()).containsExactly("node_a", "node_b", "node_c", "node_d");
    }

    @Test
    void buildContext_handlesUnsupportedLegacyFlowsAndSingleNodeGracefully() {
        OfflineFlowInspector.InspectedGraph legacyMulti = diamondGraph(false);
        OperationsExecutionRerunContextResponse multiContext = OperationsRerunGraphPlanner.buildContext(
                executionWithRuns(List.of(taskRun("node_a", "SUCCESS"), taskRun("node_b", "FAILED"))),
                legacyMulti
        );
        assertThat(multiContext.partialRerunSupported()).isFalse();
        assertThat(multiContext.defaultSelectedTaskIds()).containsExactly("node_a", "node_b", "node_c", "node_d");
        assertThat(multiContext.requiredTaskIds()).containsExactly("node_a", "node_b", "node_c", "node_d");
        assertThat(multiContext.fallbackReason()).contains("暂不支持按节点重跑");

        OfflineFlowInspector.InspectedGraph legacySingle = new OfflineFlowInspector.InspectedGraph(
                "single", "g4-main", List.of(node("only_node", "SHELL", null)), List.of(), false);
        OperationsExecutionRerunContextResponse singleContext = OperationsRerunGraphPlanner.buildContext(
                executionWithRuns(List.of(taskRun("only_node", "FAILED"))),
                legacySingle
        );
        assertThat(singleContext.partialRerunSupported()).isFalse();
        assertThat(singleContext.fallbackReason()).isNull();
    }

    @Test
    void buildContext_fallsBackToSelectingAllWhenGraphStructureChanged() {
        OfflineFlowInspector.InspectedGraph graph = diamondGraph(true);
        KestraExecutionSnapshot original = executionWithRuns(List.of(
                taskRun("node_a", "SUCCESS"),
                taskRun("removed_legacy_step", "FAILED"),
                taskRun("node_b", "SUCCESS")
        ));

        OperationsExecutionRerunContextResponse context = OperationsRerunGraphPlanner.buildContext(original, graph);

        assertThat(context.graphChanged()).isTrue();
        assertThat(context.fallbackReason()).contains("结构已更新");
        assertThat(context.defaultSelectedTaskIds()).containsExactly("node_a", "node_b", "node_c", "node_d");
        assertThat(context.requiredTaskIds()).containsExactly("node_c", "node_d");
    }

    @Test
    void resolveSelection_enforcesRequiredConvexityAndNormalizesFullSelection() {
        OfflineFlowInspector.InspectedGraph chain = new OfflineFlowInspector.InspectedGraph(
                "chain",
                "g4-main",
                List.of(
                        node("a", "SHELL", null),
                        node("b", "SHELL", null),
                        node("c", "SHELL", null),
                        node("d", "SHELL", null)
                ),
                List.of(
                        new OfflineFlowInspector.InspectedEdge("a", "b"),
                        new OfflineFlowInspector.InspectedEdge("b", "c"),
                        new OfflineFlowInspector.InspectedEdge("c", "d")
                ),
                true
        );
        OperationsExecutionRerunContextResponse context = OperationsRerunGraphPlanner.buildContext(
                executionWithRuns(List.of(
                        taskRun("a", "SUCCESS"),
                        taskRun("b", "SUCCESS"),
                        taskRun("c", "FAILED")
                )),
                chain
        );

        assertThatThrownBy(() -> OperationsRerunGraphPlanner.resolveSelection(context, List.of()))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getReason()).contains("至少选择一个"));

        assertThatThrownBy(() -> OperationsRerunGraphPlanner.resolveSelection(context, List.of("c", "d", "ghost")))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getReason()).contains("不存在"));

        assertThatThrownBy(() -> OperationsRerunGraphPlanner.resolveSelection(context, List.of("b", "c")))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getReason()).contains("d"));

        assertThatThrownBy(() -> OperationsRerunGraphPlanner.resolveSelection(context, List.of("a", "c", "d")))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getReason()).contains("未选中的中间节点").contains("b"));

        OperationsRerunGraphPlanner.SelectionResolution partial =
                OperationsRerunGraphPlanner.resolveSelection(context, List.of("d", "b", "c"));
        assertThat(partial.partial()).isTrue();
        assertThat(partial.orderedSelectedTaskIds()).containsExactly("b", "c", "d");
        assertThat(partial.totalNodeCount()).isEqualTo(4);

        OperationsRerunGraphPlanner.SelectionResolution full =
                OperationsRerunGraphPlanner.resolveSelection(context, List.of("d", "a", "c", "b"));
        assertThat(full.partial()).isFalse();
        assertThat(full.orderedSelectedTaskIds()).containsExactly("a", "b", "c", "d");

        OperationsRerunGraphPlanner.SelectionResolution legacyNull =
                OperationsRerunGraphPlanner.resolveSelection(context, null);
        assertThat(legacyNull.partial()).isFalse();
    }

    private static OfflineFlowInspector.InspectedGraph diamondGraph(boolean partialRerunSupported) {
        return new OfflineFlowInspector.InspectedGraph(
                "diamond",
                "g4-main",
                List.of(
                        node("node_a", "MYSQL", "MYSQL"),
                        node("node_b", "SHELL", null),
                        node("node_c", "SHELL", null),
                        node("node_d", "HIVE_SQL", "HIVE")
                ),
                List.of(
                        new OfflineFlowInspector.InspectedEdge("node_a", "node_b"),
                        new OfflineFlowInspector.InspectedEdge("node_a", "node_c"),
                        new OfflineFlowInspector.InspectedEdge("node_b", "node_d"),
                        new OfflineFlowInspector.InspectedEdge("node_c", "node_d")
                ),
                partialRerunSupported
        );
    }

    private static OfflineFlowInspector.InspectedNode node(String id, String kind, String dataSourceType) {
        return new OfflineFlowInspector.InspectedNode(id, kind, dataSourceType);
    }

    private static KestraTaskRunSnapshot taskRun(String id, String status) {
        return new KestraTaskRunSnapshot(id, status, null, null);
    }

    private static KestraExecutionSnapshot executionWithRuns(List<KestraTaskRunSnapshot> taskRuns) {
        return new KestraExecutionSnapshot(
                "exec-1", "g4-main", "diamond", "FAILED",
                Instant.parse("2026-06-07T00:00:00Z"),
                Instant.parse("2026-06-07T00:00:01Z"),
                Instant.parse("2026-06-07T00:00:02Z"),
                Instant.parse("2026-06-07T00:01:00Z"),
                taskRuns, Map.of(), Map.of(), Map.of()
        );
    }
}
