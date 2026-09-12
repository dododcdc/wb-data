package com.wbdata.offline.dto;

import java.time.Duration;
import java.time.Instant;

/**
 * 执行节点运行快照，offline 调试轨与 operations 运维轨共用。
 */
public record ExecutionTaskRun(
        String taskId,
        String status,
        Instant startDate,
        Instant endDate,
        Long durationMs
) {

    public static ExecutionTaskRun of(String taskId, String status, Instant startDate, Instant endDate) {
        Long durationMs = (startDate != null && endDate != null)
                ? Duration.between(startDate, endDate).toMillis()
                : null;
        return new ExecutionTaskRun(taskId, status, startDate, endDate, durationMs);
    }
}
