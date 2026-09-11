package com.wbdata.parameter.dto;

public record ParameterDefinitionResponse(
        Long id,
        String key,
        String valueSource,
        String constantValue,
        String timeBasis,
        String format,
        Integer offsetDays,
        String description,
        Integer sortOrder
) {
}
