package com.wbdata.offline.dto;

public record BranchItemResponse(
        String name,
        boolean current,
        boolean local,
        boolean remote,
        String remoteName,
        String trackingBranch
) {
}
