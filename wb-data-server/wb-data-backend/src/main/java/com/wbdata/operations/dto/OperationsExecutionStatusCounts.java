package com.wbdata.operations.dto;

public record OperationsExecutionStatusCounts(
        int total,
        int success,
        int failed,
        int active,
        int stopped
) {
}
