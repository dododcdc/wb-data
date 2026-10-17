package com.wbdata.offline.execution.dto;

public record OfflineExecutionScriptResponse(
        String executionId,
        String flowPath,
        String content
) {
}
