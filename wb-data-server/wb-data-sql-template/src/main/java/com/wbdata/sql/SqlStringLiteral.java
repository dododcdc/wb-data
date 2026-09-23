package com.wbdata.sql;

import java.nio.charset.StandardCharsets;
import java.util.HexFormat;

// Hex expressions avoid depending on database quote and backslash modes.
public final class SqlStringLiteral {

    private SqlStringLiteral() {
    }

    public static String render(String databaseType, String value) {
        if (databaseType == null || value == null) {
            throw new IllegalArgumentException("数据库类型和字符串值不能为 null");
        }
        String hex = HexFormat.of().formatHex(value.getBytes(StandardCharsets.UTF_8));
        return switch (databaseType) {
            case "MYSQL" -> "CONVERT(X'" + hex + "' USING utf8mb4)";
            case "POSTGRESQL" -> "convert_from(decode('" + hex + "', 'hex'), 'UTF8')";
            case "CLICKHOUSE" -> "unhex('" + hex + "')";
            case "HIVE" -> "decode(unhex('" + hex + "'), 'UTF-8')";
            default -> throw new IllegalArgumentException("不支持的数据库类型: " + databaseType);
        };
    }
}
