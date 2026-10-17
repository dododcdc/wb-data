package com.wbdata.offline.parameter.dto;

public record ExecutionParameterValueResponse(
        String key,
        String dataType,
        String value,
        String source
) {
}
