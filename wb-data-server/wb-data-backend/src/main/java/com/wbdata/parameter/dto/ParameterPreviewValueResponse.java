package com.wbdata.parameter.dto;

public record ParameterPreviewValueResponse(
        String key,
        String valueSource,
        String timeBasis,
        String value,
        boolean overridden
) {
}
