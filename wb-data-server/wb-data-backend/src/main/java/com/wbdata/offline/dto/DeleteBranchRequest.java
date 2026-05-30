package com.wbdata.offline.dto;

import jakarta.validation.constraints.NotBlank;

public record DeleteBranchRequest(@NotBlank String name, boolean force) {
}
