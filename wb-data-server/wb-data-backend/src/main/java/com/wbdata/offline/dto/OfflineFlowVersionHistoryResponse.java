package com.wbdata.offline.dto;

import java.util.List;

public record OfflineFlowVersionHistoryResponse(
        String branch,
        List<OfflineFlowVersionItem> items,
        long total,
        int page,
        int size
) {
}
