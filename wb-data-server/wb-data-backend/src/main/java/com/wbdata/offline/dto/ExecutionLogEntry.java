package com.wbdata.offline.dto;

import java.time.Instant;

/**
 * 执行日志条目，offline 调试轨与 operations 运维轨共用。
 */
public record ExecutionLogEntry(
        Instant timestamp,
        String taskId,
        String level,
        String message
) {
}
