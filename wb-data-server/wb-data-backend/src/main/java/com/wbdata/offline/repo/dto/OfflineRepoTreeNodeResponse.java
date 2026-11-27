package com.wbdata.offline.repo.dto;

import java.util.List;

public record OfflineRepoTreeNodeResponse(
        String id,
        String kind,
        String name,
        String path,
        List<OfflineRepoTreeNodeResponse> children,
        String scheduleState,
        String schedulePeriod,
        int dependencyCount,
        Long ownerUserId,
        String ownerName,
        String ownerUsername,
        String ownerStatus
) {
    public OfflineRepoTreeNodeResponse(
            String id,
            String kind,
            String name,
            String path,
            List<OfflineRepoTreeNodeResponse> children,
            String scheduleState,
            String schedulePeriod,
            int dependencyCount
    ) {
        this(id, kind, name, path, children, scheduleState, schedulePeriod, dependencyCount, null, null, null, null);
    }

    public static OfflineRepoTreeNodeResponse directory(String id, String kind, String name, String path,
                                                        List<OfflineRepoTreeNodeResponse> children) {
        return new OfflineRepoTreeNodeResponse(id, kind, name, path, children, "NONE", null, 0);
    }
}
