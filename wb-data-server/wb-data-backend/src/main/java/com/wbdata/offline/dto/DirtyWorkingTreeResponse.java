package com.wbdata.offline.dto;

import java.util.List;

public record DirtyWorkingTreeResponse(
        List<String> changedFlows,
        List<String> changedFiles,
        int otherFileCount,
        List<DirtyFlowChangeResponse> changedFlowDetails
) {
    public DirtyWorkingTreeResponse(List<String> changedFlows, List<String> changedFiles, int otherFileCount) {
        this(
                changedFlows,
                changedFiles,
                otherFileCount,
                changedFlows.stream()
                        .map(path -> new DirtyFlowChangeResponse(path, "MODIFIED"))
                        .toList()
        );
    }
}
