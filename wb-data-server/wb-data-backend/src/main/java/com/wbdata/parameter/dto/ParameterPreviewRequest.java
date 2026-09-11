package com.wbdata.parameter.dto;

import jakarta.validation.constraints.NotBlank;

import java.time.LocalDateTime;
import java.util.Map;

public record ParameterPreviewRequest(
        LocalDateTime executionStartTime,
        LocalDateTime plannedTime,
        @NotBlank String runtimeTimezone,
        Map<String, String> overrides
) {
}
