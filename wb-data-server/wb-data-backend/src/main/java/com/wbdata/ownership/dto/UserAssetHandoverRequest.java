package com.wbdata.ownership.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;

import java.util.List;

public record UserAssetHandoverRequest(
        @NotEmpty(message = "请为存在资产的项目组指定交接目标负责人")
        List<@Valid GroupTransferTarget> transfers
) {
    public record GroupTransferTarget(
            @NotNull(message = "项目组 ID 不能为空")
            Long groupId,
            @NotNull(message = "请选择接手人")
            Long targetOwnerUserId
    ) {
    }
}
