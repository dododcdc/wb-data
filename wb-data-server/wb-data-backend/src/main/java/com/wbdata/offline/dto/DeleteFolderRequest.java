package com.wbdata.offline.dto;

import jakarta.validation.constraints.NotBlank;

public record DeleteFolderRequest(
        Long groupId,
        @NotBlank String path
) {
}
