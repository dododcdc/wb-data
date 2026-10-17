package com.wbdata.offline.repo.dto;

public record OfflineRepoTreeResponse(
        Long groupId,
        OfflineRepoTreeNodeResponse root
) {
}
