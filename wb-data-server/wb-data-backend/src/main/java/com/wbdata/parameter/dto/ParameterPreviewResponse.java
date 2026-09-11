package com.wbdata.parameter.dto;

import java.time.OffsetDateTime;
import java.util.List;

public record ParameterPreviewResponse(
        Long parameterGroupId,
        Integer version,
        String runtimeTimezone,
        OffsetDateTime plannedTime,
        OffsetDateTime executionStartTime,
        List<ParameterPreviewValueResponse> values
) {
}
