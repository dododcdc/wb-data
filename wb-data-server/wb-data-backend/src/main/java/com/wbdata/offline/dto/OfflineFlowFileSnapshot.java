package com.wbdata.offline.dto;

public record OfflineFlowFileSnapshot(
        String path,
        String sha256,
        long size,
        String content
) {
}
