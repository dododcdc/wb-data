package com.wbdata.offline.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record OfflineFlowDependencyRef(
        @NotNull Long groupId,
        @NotBlank String flowId
) {
}
