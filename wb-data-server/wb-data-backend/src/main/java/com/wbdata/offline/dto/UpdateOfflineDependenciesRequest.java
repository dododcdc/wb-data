package com.wbdata.offline.dto;

import com.wbdata.offline.enums.OfflineCrossGroupDependency;
import com.wbdata.offline.enums.OfflineFailurePolicy;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.List;

public record UpdateOfflineDependenciesRequest(
        Long groupId,
        @NotBlank String path,
        @NotNull List<@Valid OfflineFlowDependencyRef> dependencies,
        @NotNull OfflineFailurePolicy failurePolicy,
        @NotNull OfflineCrossGroupDependency crossGroupDependency,
        @NotBlank String contentHash,
        long fileUpdatedAt
) {
}
