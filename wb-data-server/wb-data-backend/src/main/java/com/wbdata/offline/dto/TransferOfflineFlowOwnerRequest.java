package com.wbdata.offline.dto;

import jakarta.validation.constraints.NotNull;

import java.util.List;

public record TransferOfflineFlowOwnerRequest(
        List<String> paths,
        Long fromOwnerUserId,
        @NotNull(message = "请选择目标负责人")
        Long targetOwnerUserId
) {
}
