package com.wbdata.offline.dto;

public record DirtyFlowChangeResponse(
        String path,
        String status
) {
}
