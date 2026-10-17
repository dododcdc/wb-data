package com.wbdata.offline.repo.dto;

import jakarta.validation.constraints.NotBlank;

public record MergeBranchRequest(@NotBlank String source, @NotBlank String target) {
}
