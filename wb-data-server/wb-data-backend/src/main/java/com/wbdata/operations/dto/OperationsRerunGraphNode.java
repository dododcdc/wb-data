package com.wbdata.operations.dto;

public record OperationsRerunGraphNode(
        String taskId,
        String kind,
        String dataSourceType,
        String executionStatus
) {
}
