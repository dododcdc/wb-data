package com.wbdata.offline.service;

import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

class OfflineFlowGraphValidationTest {

    private final OfflineFlowGraphValidation validation = new OfflineFlowGraphValidation();

    @Test
    void rejectsGraphsThatWouldGainImplicitDependenciesAfterSave() {
        List<OfflineFlowYamlSupport.FlowNode> nodes = List.of(
                new OfflineFlowYamlSupport.FlowNode("a", "SHELL", "scripts/demo/a.sh", null, null),
                new OfflineFlowYamlSupport.FlowNode("b", "SHELL", "scripts/demo/b.sh", null, null),
                new OfflineFlowYamlSupport.FlowNode("c", "SQL", "scripts/demo/c.sql", null, null)
        );
        List<OfflineFlowYamlSupport.FlowEdge> edges = List.of(
                new OfflineFlowYamlSupport.FlowEdge("a", "b")
        );

        assertThrows(ResponseStatusException.class, () -> validation.assertNoImplicitDependencies(nodes, edges));
    }

    @Test
    void acceptsGraphsWhenAllRoundTripDependenciesAreExplicit() {
        List<OfflineFlowYamlSupport.FlowNode> nodes = List.of(
                new OfflineFlowYamlSupport.FlowNode("a", "SHELL", "scripts/demo/a.sh", null, null),
                new OfflineFlowYamlSupport.FlowNode("b", "SHELL", "scripts/demo/b.sh", null, null),
                new OfflineFlowYamlSupport.FlowNode("c", "SQL", "scripts/demo/c.sql", null, null)
        );
        List<OfflineFlowYamlSupport.FlowEdge> edges = List.of(
                new OfflineFlowYamlSupport.FlowEdge("a", "b"),
                new OfflineFlowYamlSupport.FlowEdge("c", "b")
        );

        assertDoesNotThrow(() -> validation.assertNoImplicitDependencies(nodes, edges));
    }
}
