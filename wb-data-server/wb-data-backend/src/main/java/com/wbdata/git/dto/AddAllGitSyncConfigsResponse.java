package com.wbdata.git.dto;

import java.util.List;

public record AddAllGitSyncConfigsResponse(
        int created,
        int existing,
        List<GitSyncConfigResponse> configs
) {
}
