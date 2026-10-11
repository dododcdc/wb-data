package com.wbdata.operations.dto;

import java.time.Instant;
import java.util.List;

public record OperationsInstanceDiagnosisResponse(
        String flowId,
        String branch,
        String namespace,
        String scheduleKey,
        String period,
        String cron,
        String timezone,
        boolean scheduleEnabled,
        Instant plannedFireAt,
        String state,
        String reason,
        List<OperationsInstanceExecutionItem> executions,
        List<OperationsInstanceUpstreamItem> upstreams,
        String prevScheduleKey,
        String nextScheduleKey
) {
}
