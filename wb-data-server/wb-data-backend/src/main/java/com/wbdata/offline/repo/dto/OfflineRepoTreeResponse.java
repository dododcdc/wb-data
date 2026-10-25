package com.wbdata.offline.repo.dto;

import java.util.List;

public record OfflineRepoTreeResponse(
        Long groupId,
        OfflineRepoTreeNodeResponse root,
        List<String> recentFlowPaths
) {
    public OfflineRepoTreeResponse {
        recentFlowPaths = recentFlowPaths == null ? List.of() : List.copyOf(recentFlowPaths);
    }

    public OfflineRepoTreeResponse(Long groupId, OfflineRepoTreeNodeResponse root) {
        this(groupId, root, List.of());
    }
}
