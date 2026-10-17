package com.wbdata.offline.repo.dto;

public record BranchItemResponse(
        String name,
        boolean current,
        boolean local,
        boolean remote,
        String remoteName,
        String trackingBranch
) {
}
