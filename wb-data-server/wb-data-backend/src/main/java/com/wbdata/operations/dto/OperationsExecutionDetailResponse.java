package com.wbdata.operations.dto;

import com.wbdata.offline.parameter.dto.ExecutionParameterValueResponse;
import com.wbdata.offline.execution.dto.ExecutionTaskRun;
import java.time.Instant;
import java.util.List;
import java.util.Map;

public record OperationsExecutionDetailResponse(
        String id,
        String namespace,
        String flowId,
        String branch,
        String status,
        Instant plannedAt,
        Instant createdAt,
        Instant startDate,
        Instant endDate,
        Long durationMs,
        boolean rerunnable,
        boolean stoppable,
        List<ExecutionTaskRun> taskRuns,
        Map<String, String> inputs,
        Map<String, String> labels,
        String parameterResolutionStatus,
        List<ExecutionParameterValueResponse> parameters,
        Boolean parameterSnapshotChanged,
        boolean rerun,
        String rerunType,
        Integer retryAttempt,
        boolean partialRerun,
        Integer rerunSelectedTaskCount,
        Integer rerunTotalTaskCount,
        boolean markableSuccess,
        boolean forceSuccess,
        String forceSuccessBy,
        Instant forceSuccessAt
) {
    public OperationsExecutionDetailResponse(
            String id,
            String namespace,
            String flowId,
            String branch,
            String status,
            Instant plannedAt,
            Instant createdAt,
            Instant startDate,
            Instant endDate,
            Long durationMs,
            boolean rerunnable,
            boolean stoppable,
            List<ExecutionTaskRun> taskRuns,
            Map<String, String> inputs,
            Map<String, String> labels,
            String parameterResolutionStatus,
            List<ExecutionParameterValueResponse> parameters,
            Boolean parameterSnapshotChanged,
            boolean rerun,
            String rerunType,
            Integer retryAttempt,
            boolean partialRerun,
            Integer rerunSelectedTaskCount,
            Integer rerunTotalTaskCount
    ) {
        this(id, namespace, flowId, branch, status, plannedAt, createdAt, startDate, endDate,
                durationMs, rerunnable, stoppable, taskRuns, inputs, labels,
                parameterResolutionStatus, parameters, parameterSnapshotChanged,
                rerun, rerunType, retryAttempt, partialRerun, rerunSelectedTaskCount, rerunTotalTaskCount,
                false, false, null, null);
    }

    public OperationsExecutionDetailResponse(
            String id,
            String namespace,
            String flowId,
            String branch,
            String status,
            Instant plannedAt,
            Instant createdAt,
            Instant startDate,
            Instant endDate,
            Long durationMs,
            boolean rerunnable,
            boolean stoppable,
            List<ExecutionTaskRun> taskRuns,
            Map<String, String> inputs,
            Map<String, String> labels,
            String parameterResolutionStatus,
            List<ExecutionParameterValueResponse> parameters,
            Boolean parameterSnapshotChanged,
            boolean rerun,
            String rerunType,
            Integer retryAttempt
    ) {
        this(id, namespace, flowId, branch, status, plannedAt, createdAt, startDate, endDate,
                durationMs, rerunnable, stoppable, taskRuns, inputs, labels,
                parameterResolutionStatus, parameters, parameterSnapshotChanged,
                rerun, rerunType, retryAttempt, false, null, null,
                false, false, null, null);
    }

    public OperationsExecutionDetailResponse(
            String id,
            String namespace,
            String flowId,
            String branch,
            String status,
            Instant plannedAt,
            Instant createdAt,
            Instant startDate,
            Instant endDate,
            Long durationMs,
            boolean rerunnable,
            boolean stoppable,
            List<ExecutionTaskRun> taskRuns,
            Map<String, String> inputs,
            Map<String, String> labels,
            String parameterResolutionStatus,
            List<ExecutionParameterValueResponse> parameters,
            Boolean parameterSnapshotChanged
    ) {
        this(id, namespace, flowId, branch, status, plannedAt, createdAt, startDate, endDate,
                durationMs, rerunnable, stoppable, taskRuns, inputs, labels,
                parameterResolutionStatus, parameters, parameterSnapshotChanged,
                false, "NONE", null, false, null, null,
                false, false, null, null);
    }
}
