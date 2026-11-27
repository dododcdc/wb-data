package com.wbdata.group.dto;

import jakarta.validation.constraints.NotNull;

import java.util.List;

public record TransferOwnerRequest(
        List<Long> ids,
        Long fromOwnerUserId,
        @NotNull(message = "目标负责人不能为空")
        Long targetOwnerUserId
) {
}
