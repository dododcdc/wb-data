package com.wbdata.offline.dto;

import java.time.Instant;
import java.util.List;

public record OfflineFlowVersionItem(
        String revision,
        String kind,
        String message,
        String authorName,
        Instant committedAt,
        boolean dirty,
        List<OfflineFlowPublicationItem> publications
) {
}
