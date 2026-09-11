package com.wbdata.parameter.dto;

import java.time.LocalDateTime;

public record ParameterGroupSummaryResponse(
        Long id,
        String code,
        String name,
        String description,
        Integer version,
        Integer revision,
        String status,
        long parameterCount,
        Long createdBy,
        Long updatedBy,
        LocalDateTime createdAt,
        LocalDateTime updatedAt
) {
}
