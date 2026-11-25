package com.wbdata.operations.dto;

import java.util.List;

public record OperationsExecutionRerunContextResponse(
        String executionId,
        String namespace,
        String flowId,
        boolean partialRerunSupported,
        boolean graphChanged,
        String fallbackReason,
        List<OperationsRerunGraphNode> nodes,
        List<OperationsRerunGraphEdge> edges,
        List<String> defaultSelectedTaskIds,
        List<String> requiredTaskIds
) {
}
