package com.wbdata.offline.dto;

import java.util.List;

public record OfflineRepoTreeNodeResponse(
        String id,
        String kind,
        String name,
        String path,
        List<OfflineRepoTreeNodeResponse> children
) {
}
