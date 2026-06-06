package com.wbdata.git.dto;

import java.util.List;

public record GitSyncConfigListResponse(
        List<GitSyncConfigResponse> configs,
        List<String> availableBranches,
        String syncCron
) {
}
