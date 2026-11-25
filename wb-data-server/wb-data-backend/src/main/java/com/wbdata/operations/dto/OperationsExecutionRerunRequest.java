package com.wbdata.operations.dto;

import java.util.List;

public record OperationsExecutionRerunRequest(
        boolean reuseManualOverrides,
        List<String> selectedTaskIds
) {
    public OperationsExecutionRerunRequest(boolean reuseManualOverrides) {
        this(reuseManualOverrides, null);
    }
}
