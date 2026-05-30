package com.wbdata.offline.dto;

import jakarta.validation.constraints.NotBlank;

public record SwitchBranchRequest(@NotBlank String branch) {
}
