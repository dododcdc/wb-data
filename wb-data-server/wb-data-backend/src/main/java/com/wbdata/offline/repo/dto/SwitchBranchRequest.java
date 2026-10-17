package com.wbdata.offline.repo.dto;

import jakarta.validation.constraints.NotBlank;

public record SwitchBranchRequest(@NotBlank String branch) {
}
