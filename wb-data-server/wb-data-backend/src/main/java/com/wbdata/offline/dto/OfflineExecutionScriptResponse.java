package com.wbdata.offline.dto;

public record OfflineExecutionScriptResponse(
        String executionId,
        String flowPath,
        String content
) {
}
