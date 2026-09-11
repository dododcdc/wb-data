package com.wbdata.offline.dto;

import jakarta.validation.constraints.Positive;

public record FlowParameterBindingRequest(
        @Positive Long parameterGroupId,
        @Positive Integer expectedVersion
) {
}
