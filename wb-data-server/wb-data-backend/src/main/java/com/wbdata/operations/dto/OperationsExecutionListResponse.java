package com.wbdata.operations.dto;

import java.time.Instant;
import java.util.List;

public record OperationsExecutionListResponse(
        List<String> branches,
        String selectedBranch,
        Instant from,
        Instant to,
        int page,
        int pageSize,
        int total,
        int totalPages,
        List<OperationsExecutionListItem> executions
) {
}
