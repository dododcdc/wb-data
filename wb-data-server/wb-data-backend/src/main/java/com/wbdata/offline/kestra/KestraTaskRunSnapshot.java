package com.wbdata.offline.kestra;

import java.time.Instant;

public record KestraTaskRunSnapshot(
        String taskId,
        String status,
        Instant startDate,
        Instant endDate
) {
}
