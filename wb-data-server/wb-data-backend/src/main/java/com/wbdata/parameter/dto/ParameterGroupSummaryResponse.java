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
        Long ownerUserId,
        String ownerName,
        String ownerUsername,
        String ownerStatus,
        Long createdBy,
        Long updatedBy,
        LocalDateTime createdAt,
        LocalDateTime updatedAt
) {
    public ParameterGroupSummaryResponse(
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
            LocalDateTime updatedAt) {
        this(id, code, name, description, version, revision, status, parameterCount,
                null, null, null, null, createdBy, updatedBy, createdAt, updatedAt);
    }
}
