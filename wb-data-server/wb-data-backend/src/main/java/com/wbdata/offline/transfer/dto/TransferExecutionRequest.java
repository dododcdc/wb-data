package com.wbdata.offline.transfer.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

import java.util.Map;

public record TransferExecutionRequest(
        @NotNull @Valid TransferRenderRequest config,
        @NotNull Map<String, @NotNull String> parameters
) {
}
