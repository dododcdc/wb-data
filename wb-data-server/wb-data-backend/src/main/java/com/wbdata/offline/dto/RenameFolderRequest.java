package com.wbdata.offline.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record RenameFolderRequest(
        @NotNull Long groupId,
        @NotBlank String path,
        @NotBlank String newName
) {
}
