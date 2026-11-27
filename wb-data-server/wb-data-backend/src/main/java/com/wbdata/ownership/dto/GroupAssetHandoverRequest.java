package com.wbdata.ownership.dto;

import jakarta.validation.constraints.NotNull;

public record GroupAssetHandoverRequest(
        @NotNull(message = "请选择接手人")
        Long targetOwnerUserId
) {
}
