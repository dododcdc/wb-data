package com.wbdata.parameter.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import java.util.List;

public record UpdateParameterGroupRequest(
        @NotNull @Positive Integer expectedRevision,
        @NotBlank @Size(max = 100) String name,
        @Size(max = 500) String description,
        @NotEmpty @Size(max = 200) List<@Valid ParameterDefinitionRequest> definitions
) {
}
