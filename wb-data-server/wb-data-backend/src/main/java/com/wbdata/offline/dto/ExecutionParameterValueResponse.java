package com.wbdata.offline.dto;

public record ExecutionParameterValueResponse(
        String key,
        String dataType,
        String value,
        String source
) {
}
