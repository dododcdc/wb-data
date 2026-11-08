package com.wbdata.offline.dto;

import java.util.List;
import java.util.Map;

public record OfflineFlowVersionSnapshotResponse(
        String revision,
        OfflineFlowDocumentResponse document,
        List<OfflineFlowFileSnapshot> files,
        Map<String, List<String>> nodeMetadata
) {
}
