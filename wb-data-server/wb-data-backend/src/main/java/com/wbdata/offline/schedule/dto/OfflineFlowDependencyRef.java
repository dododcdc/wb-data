package com.wbdata.offline.schedule.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record OfflineFlowDependencyRef(
        @NotNull Long groupId,
        @NotBlank String flowId
) {
}
