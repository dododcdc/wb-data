package com.wbdata.offline.dto;

import com.wbdata.offline.enums.OfflineCrossGroupDependency;
import com.wbdata.offline.enums.OfflineFailurePolicy;

import java.util.List;

public record OfflineDependencyConfigResponse(
        Long groupId,
        String path,
        List<OfflineDependencyItemResponse> dependencies,
        OfflineFailurePolicy failurePolicy,
        OfflineCrossGroupDependency crossGroupDependency,
        String contentHash,
        long fileUpdatedAt
) {
}
