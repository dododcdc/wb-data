package com.wbdata.parameter.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record ParameterDefinitionRequest(
        @NotBlank @Size(max = 64) String key,
        @NotBlank String valueSource,
        String constantValue,
        @Size(max = 32) String timeBasis,
        @Size(max = 64) String format,
        Integer offsetDays,
        @Size(max = 255) String description,
        Integer sortOrder
) {
}
