package com.wbdata.offline.dto;

import java.util.List;

public record FlowParameterBindingResponse(
        Long parameterGroupId,
        String code,
        String name,
        Integer boundVersion,
        Integer currentVersion,
        String status,
        List<FlowParameterDefinitionSnapshot> definitions,
        List<FlowParameterBindingItemResponse> bindings
) {
    public FlowParameterBindingResponse(
            Long parameterGroupId,
            String code,
            String name,
            Integer boundVersion,
            Integer currentVersion,
            String status,
            List<FlowParameterDefinitionSnapshot> definitions
    ) {
        this(parameterGroupId, code, name, boundVersion, currentVersion, status, definitions, null);
    }
}
