package com.wbdata.operations.dto;

import java.time.Instant;
import java.util.List;

public record OperationsExecutionListResponse(
        List<String> branches,
        String selectedBranch,
        Instant from,
        Instant to,
        List<OperationsExecutionListItem> executions
) {
}
