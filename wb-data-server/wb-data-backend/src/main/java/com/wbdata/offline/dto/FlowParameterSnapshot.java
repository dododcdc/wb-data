package com.wbdata.offline.dto;

import java.util.List;

public record FlowParameterSnapshot(
        int schemaVersion,
        String runtimeTimezone,
        String groupCode,
        int groupVersion,
        List<FlowParameterDefinitionSnapshot> definitions,
        List<FlowParameterGroupBindingSnapshot> groups
) {
    public FlowParameterSnapshot(int schemaVersion,
                                 String runtimeTimezone,
                                 String groupCode,
                                 int groupVersion,
                                 List<FlowParameterDefinitionSnapshot> definitions) {
        this(schemaVersion, runtimeTimezone, groupCode, groupVersion, definitions, null);
    }
}
