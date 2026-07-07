package com.wbdata.offline.dto;

import jakarta.validation.constraints.NotBlank;

public record RenameFolderRequest(
        Long groupId,
        @NotBlank String path,
        @NotBlank String newName
) {
}
