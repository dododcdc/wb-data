package com.wbdata.plugin.api;

/**
 * Summary metadata returned after streaming a query result through {@link QueryRowHandler}.
 */
public record QueryStreamSummary(int rowCount, boolean truncated, long executionTimeMs) {
}
