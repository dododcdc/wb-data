package com.wbdata.offline.repo.dto;

import jakarta.validation.constraints.NotBlank;

public record CreateBranchRequest(@NotBlank String name, @NotBlank String baseBranch) {
}
