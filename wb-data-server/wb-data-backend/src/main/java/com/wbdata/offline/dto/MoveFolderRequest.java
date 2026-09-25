package com.wbdata.offline.dto;

import jakarta.validation.constraints.NotBlank;

public record MoveFolderRequest(
        Long groupId,
        @NotBlank String path,
        @NotBlank String newPath
) {
}
