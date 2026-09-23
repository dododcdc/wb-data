package com.wbdata.offline.transfer.dto;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.wbdata.sql.SqlStatementValidator;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.List;
import java.util.stream.Stream;

public record TransferEndpointConfig(
        @NotNull Long dataSourceId,
        @NotBlank @Pattern(regexp = "MYSQL|POSTGRESQL|CLICKHOUSE|HIVE") String dataSourceType,
        String database,
        @NotBlank String table,
        @Pattern(regexp = "(?is)^(?!.*;)(?!\\s*(?:select|from|insert|update|delete|drop|alter|truncate)\\b).*$",
                message = "Transfer predicate must be a SQL fragment") String where,
        TransferWriteMode writeMode,
        @Size(max = 5, message = "前置 SQL 最多 5 条") List<@NotBlank String> preSql,
        @Size(max = 5, message = "后置 SQL 最多 5 条") List<@NotBlank String> postSql
) {
    public boolean hasSql() {
        return (preSql != null && !preSql.isEmpty()) || (postSql != null && !postSql.isEmpty());
    }

    @AssertTrue(message = "前置和后置 SQL 仅支持 MySQL、PostgreSQL、ClickHouse，并需选择目标数据库")
    @JsonIgnore
    public boolean isValidSqlTarget() {
        return !hasSql() || (database != null && !database.isBlank()
                && ("MYSQL".equals(dataSourceType) || "POSTGRESQL".equals(dataSourceType)
                || "CLICKHOUSE".equals(dataSourceType)));
    }

    @AssertTrue(message = "前置和后置 SQL 每项只能填写一条完整语句")
    @JsonIgnore
    public boolean isValidSqlStatements() {
        return Stream.of(preSql, postSql)
                .filter(statements -> statements != null)
                .flatMap(List::stream)
                .allMatch(sql -> SqlStatementValidator.isSingleStatement(sql, dataSourceType));
    }
}
