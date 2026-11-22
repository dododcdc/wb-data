package com.wbdata.offline.credential.dto;

import jakarta.validation.constraints.NotNull;

public record DataSourceCredentialRequest(
        @NotNull(message = "groupId 不能为空") Long groupId,
        @NotNull(message = "dataSourceId 不能为空") Long dataSourceId,
        String expectedType
) {
}
