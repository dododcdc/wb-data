package com.wbdata.offline.parameter.dto;

import java.util.List;

public record FlowParameterBindingItemResponse(
        Long parameterGroupId,
        String code,
        String name,
        Integer boundVersion,
        Integer currentVersion,
        String status,
        List<FlowParameterDefinitionSnapshot> definitions
) {
}
