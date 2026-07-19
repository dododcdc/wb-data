package com.wbdata.offline.transfer.service;

import java.util.Locale;

public final class SqlIdentifierQuoter {

    public String quote(String dataSourceType, String identifier) {
        String quote = switch (normalize(dataSourceType)) {
            case "MYSQL", "STARROCKS", "HIVE" -> "`";
            case "POSTGRESQL" -> "\"";
            default -> throw new IllegalArgumentException("Unsupported data source type: " + dataSourceType);
        };
        return quote + requireIdentifier(identifier).replace(quote, quote + quote) + quote;
    }

    private String normalize(String dataSourceType) {
        return dataSourceType == null ? "" : dataSourceType.trim().toUpperCase(Locale.ROOT);
    }

    private String requireIdentifier(String identifier) {
        if (identifier == null || identifier.isBlank()) {
            throw new IllegalArgumentException("SQL identifier must not be blank");
        }
        return identifier;
    }
}
