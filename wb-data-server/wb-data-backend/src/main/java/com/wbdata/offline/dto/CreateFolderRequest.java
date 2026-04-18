package com.wbdata.offline.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record CreateFolderRequest(
        @NotNull Long groupId,
        @NotBlank String path
) {
}
