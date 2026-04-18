package com.wbdata.offline.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;

import java.util.List;
import java.util.Map;

public record SaveOfflineFlowDocumentRequest(
        @NotNull Long groupId,
        @NotBlank String path,
        String documentHash,
        long documentUpdatedAt,
        List<@Valid SaveOfflineFlowStageRequest> stages,
        List<SaveOfflineFlowEdgeRequest> edges,
        Map<String, NodePosition> layout
) {
}
