package com.wbdata.operations.dto;

import com.wbdata.offline.parameter.dto.ExecutionParameterValueResponse;

import java.util.List;

public record OperationsExecutionNodeSnapshotResponse(
        String executionId,
        String taskId,
        String kind,
        String dataSourceType,
        Long dataSourceId,
        String dataSourceName,
        String scriptPath,
        String snapshotSource,
        String snapshotCommitSha,
        boolean exactSnapshot,
        String snapshotNotice,
        boolean contentAvailable,
        String rawContent,
        String renderedContent,
        String renderNote,
        String renderError,
        List<ExecutionParameterValueResponse> referencedParameters,
        OperationsTransferSnapshot transfer
) {
}
