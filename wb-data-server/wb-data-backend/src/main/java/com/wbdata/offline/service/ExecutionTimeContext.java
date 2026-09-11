package com.wbdata.offline.service;

import java.time.Instant;

/**
 * The two independent clocks that may be referenced while resolving Flow parameters.
 */
public record ExecutionTimeContext(
        Instant plannedTime,
        Instant executionStartTime
) {
    public static final String PLANNED_TIME_INPUT = "wbdata_planned_time";
}
