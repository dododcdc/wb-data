package com.wbdata.offline.transfer.service;

import com.wbdata.datasource.entity.DataSource;

import java.util.Locale;

public final class JdbcDriverCatalog {

    private final String containerHostRewrite;

    public JdbcDriverCatalog(String containerHostRewrite) {
        this.containerHostRewrite = containerHostRewrite == null ? "" : containerHostRewrite.trim();
    }

    public JdbcConnection resolve(DataSource dataSource, String databaseName) {
        if (dataSource == null) {
            throw new IllegalArgumentException("Data source is required");
        }
        String type = normalize(dataSource.getType());
        String database = databaseName == null || databaseName.isBlank() ? "" : "/" + databaseName;
        String prefix = switch (type) {
            case "MYSQL" -> "jdbc:mysql://";
            case "POSTGRESQL" -> "jdbc:postgresql://";
            case "CLICKHOUSE" -> "jdbc:clickhouse://";
            case "HIVE" -> "jdbc:hive2://";
            default -> throw new IllegalArgumentException("Unsupported data source type: " + dataSource.getType());
        };
        String driver = switch (type) {
            case "MYSQL" -> "com.mysql.cj.jdbc.Driver";
            case "POSTGRESQL" -> "org.postgresql.Driver";
            case "CLICKHOUSE" -> "com.clickhouse.jdbc.ClickHouseDriver";
            case "HIVE" -> "org.apache.hive.jdbc.HiveDriver";
            default -> throw new IllegalArgumentException("Unsupported data source type: " + dataSource.getType());
        };
        if (dataSource.getHost() == null || dataSource.getHost().isBlank() || dataSource.getPort() == null) {
            throw new IllegalArgumentException("Data source host and port are required");
        }
        return new JdbcConnection(prefix + rewriteContainerHost(dataSource.getHost(), containerHostRewrite) + ":"
                + dataSource.getPort() + database, driver);
    }

    public static String rewriteContainerHost(String host, String containerHostRewrite) {
        if (host == null || containerHostRewrite == null || containerHostRewrite.isBlank()) {
            return host;
        }
        String normalized = host.trim().toLowerCase(Locale.ROOT);
        if ("localhost".equals(normalized) || "127.0.0.1".equals(normalized) || "::1".equals(normalized)) {
            return containerHostRewrite.trim();
        }
        return host;
    }

    private String normalize(String type) {
        return type == null ? "" : type.trim().toUpperCase(Locale.ROOT);
    }

    public record JdbcConnection(String url, String driver) {
    }
}
