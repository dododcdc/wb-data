package com.wbdata.offline.service;

final class OfflineFlowNodeKinds {
    private OfflineFlowNodeKinds() {
    }

    static boolean isJdbcSql(String kind) {
        String normalized = normalize(kind);
        return "SQL".equals(normalized)
                || "MYSQL".equals(normalized)
                || "POSTGRESQL".equals(normalized)
                || "CLICKHOUSE".equals(normalized);
    }

    static boolean requiresDataSource(String kind) {
        return isJdbcSql(kind) || "HIVE_SQL".equals(normalize(kind));
    }

    static String canonicalize(String kind, String dataSourceType) {
        String normalizedKind = normalize(kind);
        if (normalizedKind == null || "SQL".equals(normalizedKind)) {
            String normalizedType = normalize(dataSourceType);
            if ("MYSQL".equals(normalizedType)
                    || "POSTGRESQL".equals(normalizedType)
                    || "CLICKHOUSE".equals(normalizedType)) {
                return normalizedType;
            }
            return "SQL";
        }
        return normalizedKind;
    }

    static String requiredDataSourceType(String kind) {
        String normalized = normalize(kind);
        return switch (normalized == null ? "" : normalized) {
            case "MYSQL" -> "MYSQL";
            case "POSTGRESQL" -> "POSTGRESQL";
            case "CLICKHOUSE" -> "CLICKHOUSE";
            default -> null;
        };
    }

    private static String normalize(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return value.trim().toUpperCase();
    }
}
