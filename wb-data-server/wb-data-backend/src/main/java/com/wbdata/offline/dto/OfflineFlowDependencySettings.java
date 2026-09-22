package com.wbdata.offline.dto;

import com.wbdata.offline.enums.OfflineCrossGroupDependency;
import com.wbdata.offline.enums.OfflineFailurePolicy;

import java.util.List;

public record OfflineFlowDependencySettings(
        List<OfflineFlowDependencyRef> dependencies,
        OfflineFailurePolicy failurePolicy,
        OfflineCrossGroupDependency crossGroupDependency
) {
    public OfflineFlowDependencySettings {
        dependencies = dependencies == null ? List.of()
                : java.util.Collections.unmodifiableList(new java.util.ArrayList<>(dependencies));
        failurePolicy = failurePolicy == null ? OfflineFailurePolicy.CONTINUE : failurePolicy;
        crossGroupDependency = crossGroupDependency == null ? OfflineCrossGroupDependency.ALLOW : crossGroupDependency;
    }
}
