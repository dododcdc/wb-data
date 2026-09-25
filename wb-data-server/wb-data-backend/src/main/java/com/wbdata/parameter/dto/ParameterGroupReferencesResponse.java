package com.wbdata.parameter.dto;

import java.util.List;

public record ParameterGroupReferencesResponse(
        int totalCount,
        List<String> sampleFlows
) {
}
