package com.wbdata.git.dto;

import jakarta.validation.constraints.NotBlank;

public record CreateGitSyncConfigRequest(
        @NotBlank(message = "分支不能为空") String branch
) {
}
