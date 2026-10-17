package com.wbdata.offline.repo.dto;

public record DirtyFlowChangeResponse(
        String path,
        String status
) {
}
