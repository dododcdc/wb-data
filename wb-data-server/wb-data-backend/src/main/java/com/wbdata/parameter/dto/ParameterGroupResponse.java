package com.wbdata.parameter.dto;

import java.time.LocalDateTime;
import java.util.List;

public record ParameterGroupResponse(
        Long id,
        String code,
        String name,
        String description,
        Integer version,
        Integer revision,
        String status,
        Long createdBy,
        Long updatedBy,
        LocalDateTime createdAt,
        LocalDateTime updatedAt,
        List<ParameterDefinitionResponse> definitions
) {
}
