package com.wbdata.offline.parameter.dto;

public record FlowParameterDefinitionSnapshot(
        String key,
        String valueSource,
        String constantValue,
        String format,
        Integer offsetDays,
        String description,
        Integer sortOrder,
        String timeBasis
) {
}
