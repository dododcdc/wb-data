package com.wbdata.offline.credential.dto;

import jakarta.validation.constraints.NotNull;

public record GitCredentialRequest(
        @NotNull(message = "groupId 不能为空") Long groupId
) {
}
