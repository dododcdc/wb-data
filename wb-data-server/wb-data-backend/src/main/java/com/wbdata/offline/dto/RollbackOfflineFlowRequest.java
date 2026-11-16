package com.wbdata.offline.dto;

import jakarta.validation.constraints.NotBlank;

public record RollbackOfflineFlowRequest(
        Long groupId,
        @NotBlank(message = "任务路径不能为空")
        String path,
        @NotBlank(message = "目标版本不能为空")
        String revision,
        String documentHash,
        Long documentUpdatedAt
) {
}
