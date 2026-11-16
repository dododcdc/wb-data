package com.wbdata.offline.dto;

import java.util.List;
import java.util.Map;

public record RollbackOfflineFlowResponse(
        OfflineFlowDocumentResponse document,
        List<String> warnings,
        Map<String, String> nodeIssues
) {
}
