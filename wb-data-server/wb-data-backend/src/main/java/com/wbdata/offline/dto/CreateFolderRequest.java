package com.wbdata.offline.dto;

import jakarta.validation.constraints.NotBlank;

public record CreateFolderRequest(
        Long groupId,
        @NotBlank String path
) {
}
