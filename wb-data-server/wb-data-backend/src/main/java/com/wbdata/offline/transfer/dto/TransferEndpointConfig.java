package com.wbdata.offline.transfer.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

public record TransferEndpointConfig(
        @NotNull Long dataSourceId,
        @NotBlank @Pattern(regexp = "MYSQL|POSTGRESQL|STARROCKS|HIVE") String dataSourceType,
        String database,
        @NotBlank String table,
        @Pattern(regexp = "(?is)^(?!.*;)(?!\\s*(?:select|from|insert|update|delete|drop|alter|truncate)\\b).*$",
                message = "Transfer predicate must be a SQL fragment") String where,
        TransferWriteMode writeMode
) {
}
