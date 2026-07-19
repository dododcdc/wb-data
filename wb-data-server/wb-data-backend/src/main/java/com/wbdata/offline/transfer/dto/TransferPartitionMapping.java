package com.wbdata.offline.transfer.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

public record TransferPartitionMapping(
        @NotBlank String target,
        @NotNull TransferMappingKind kind,
        String source,
        @Pattern(regexp = "(?is)^(?!.*;)(?!\\s*(?:select|from|insert|update|delete|drop|alter|truncate)\\b).*$",
                message = "Transfer expression must be a SQL fragment") String expression,
        String value
) {
}
