package com.wbdata.offline.dto;

import jakarta.validation.constraints.NotBlank;

public record RenameOfflineFlowRequest(
        Long groupId,
        @NotBlank String path,
        @NotBlank String newName
) {
}
