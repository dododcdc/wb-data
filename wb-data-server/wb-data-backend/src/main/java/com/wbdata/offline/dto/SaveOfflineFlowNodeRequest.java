package com.wbdata.offline.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record SaveOfflineFlowNodeRequest(
        @NotBlank String taskId,
        @NotNull String scriptContent,
        @NotBlank String kind,
        @NotBlank String scriptPath,
        Long dataSourceId,
        String dataSourceType
) {
}
