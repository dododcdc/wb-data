package com.wbdata.parameter.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.List;

public record CreateParameterGroupRequest(
        @NotBlank @Size(max = 64)
        @Pattern(regexp = "[A-Za-z][A-Za-z0-9_]{0,63}", message = "参数组代码格式不正确")
        String code,
        @NotBlank @Size(max = 100) String name,
        @Size(max = 500) String description,
        @NotEmpty @Size(max = 200) List<@Valid ParameterDefinitionRequest> definitions
) {
}
