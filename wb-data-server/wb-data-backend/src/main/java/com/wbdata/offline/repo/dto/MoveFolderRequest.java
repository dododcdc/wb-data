package com.wbdata.offline.repo.dto;

import jakarta.validation.constraints.NotBlank;

public record MoveFolderRequest(
        Long groupId,
        @NotBlank String path,
        @NotBlank String newPath
) {
}
