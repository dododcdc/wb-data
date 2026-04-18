package com.wbdata.offline.dto;

public record OfflineRepoTreeResponse(
        Long groupId,
        OfflineRepoTreeNodeResponse root
) {
}
