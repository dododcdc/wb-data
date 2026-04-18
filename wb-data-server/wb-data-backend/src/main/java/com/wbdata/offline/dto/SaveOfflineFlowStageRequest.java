package com.wbdata.offline.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;

import java.util.List;

public record SaveOfflineFlowStageRequest(
        @NotBlank String stageId,
        @NotEmpty List<@Valid SaveOfflineFlowNodeRequest> nodes
) {
}
