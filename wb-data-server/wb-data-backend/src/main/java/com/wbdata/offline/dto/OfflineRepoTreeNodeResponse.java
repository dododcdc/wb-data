package com.wbdata.offline.dto;

import java.util.List;

public record OfflineRepoTreeNodeResponse(
        String id,
        String kind,
        String name,
        String path,
        List<OfflineRepoTreeNodeResponse> children,
        String scheduleState,
        String schedulePeriod,
        int dependencyCount
) {
    public static OfflineRepoTreeNodeResponse directory(String id, String kind, String name, String path,
                                                        List<OfflineRepoTreeNodeResponse> children) {
        return new OfflineRepoTreeNodeResponse(id, kind, name, path, children, "NONE", null, 0);
    }
}
