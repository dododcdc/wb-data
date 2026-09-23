package com.wbdata.sql;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SqlStringLiteralTest {

    @ParameterizedTest
    @MethodSource("values")
    void rendersOnlyUtf8HexInEachDialect(String value, String hex) {
        assertThat(SqlStringLiteral.render("MYSQL", value))
                .isEqualTo("CONVERT(X'" + hex + "' USING utf8mb4)");
        assertThat(SqlStringLiteral.render("POSTGRESQL", value))
                .isEqualTo("convert_from(decode('" + hex + "', 'hex'), 'UTF8')");
        assertThat(SqlStringLiteral.render("CLICKHOUSE", value))
                .isEqualTo("unhex('" + hex + "')");
        assertThat(SqlStringLiteral.render("HIVE", value))
                .isEqualTo("decode(unhex('" + hex + "'), 'UTF-8')");
    }

    private static Stream<Arguments> values() {
        return Stream.of(
                Arguments.of("", ""),
                Arguments.of("abc", "616263"),
                Arguments.of("'\"`", "272260"),
                Arguments.of("\\", "5c"),
                Arguments.of("中文", "e4b8ade69687"),
                Arguments.of("a'\\中文", "61275ce4b8ade69687"),
                Arguments.of("\uD834\uDD1E", "f09d849e"),
                Arguments.of("\0\r\n\t", "000d0a09"),
                Arguments.of("' OR 1=1 --", "27204f5220313d31202d2d"),
                Arguments.of("'; DROP TABLE t; --\\", "273b2044524f50205441424c4520743b202d2d5c"),
                Arguments.of("${name}?", "247b6e616d657d3f")
        );
    }

    @ParameterizedTest
    @ValueSource(strings = {"MYSQL", "POSTGRESQL", "CLICKHOUSE", "HIVE"})
    void rejectsNullValue(String databaseType) {
        assertThatThrownBy(() -> SqlStringLiteral.render(databaseType, null))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("null");
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"ORACLE", "MYSQL'); DROP TABLE t; --"})
    void rejectsUnsupportedDatabaseTypes(String databaseType) {
        assertThatThrownBy(() -> SqlStringLiteral.render(databaseType, "value"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void templateRenderingKeepsMaliciousValuesInsideTheHexExpression() {
        String value = "'; DROP TABLE t; --\\";
        assertThat(SqlParameterTemplate.render("select * from t where name = ${value}",
                name -> SqlStringLiteral.render("MYSQL", value)))
                .isEqualTo("select * from t where name = CONVERT(X'273b2044524f50205441424c4520743b202d2d5c' USING utf8mb4)");
    }
}
