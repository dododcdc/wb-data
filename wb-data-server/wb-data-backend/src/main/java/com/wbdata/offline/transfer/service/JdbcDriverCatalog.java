package com.wbdata.offline.transfer.service;

import com.wbdata.datasource.entity.DataSource;

import java.util.Locale;

public final class JdbcDriverCatalog {

    public JdbcConnection resolve(DataSource dataSource, String databaseName) {
        if (dataSource == null) {
            throw new IllegalArgumentException("Data source is required");
        }
        String type = normalize(dataSource.getType());
        String database = databaseName == null || databaseName.isBlank() ? "" : "/" + databaseName;
        String prefix = switch (type) {
            case "MYSQL", "STARROCKS" -> "jdbc:mysql://";
            case "POSTGRESQL" -> "jdbc:postgresql://";
            case "HIVE" -> "jdbc:hive2://";
            default -> throw new IllegalArgumentException("Unsupported data source type: " + dataSource.getType());
        };
        String driver = switch (type) {
            case "MYSQL", "STARROCKS" -> "com.mysql.cj.jdbc.Driver";
            case "POSTGRESQL" -> "org.postgresql.Driver";
            case "HIVE" -> "org.apache.hive.jdbc.HiveDriver";
            default -> throw new IllegalArgumentException("Unsupported data source type: " + dataSource.getType());
        };
        if (dataSource.getHost() == null || dataSource.getHost().isBlank() || dataSource.getPort() == null) {
            throw new IllegalArgumentException("Data source host and port are required");
        }
        return new JdbcConnection(prefix + resolveDockerReachableHost(dataSource.getHost()) + ":"
                + dataSource.getPort() + database, driver);
    }

    private String normalize(String type) {
        return type == null ? "" : type.trim().toUpperCase(Locale.ROOT);
    }

    private String resolveDockerReachableHost(String host) {
        String normalized = host.trim().toLowerCase(Locale.ROOT);
        if ("localhost".equals(normalized) || "127.0.0.1".equals(normalized) || "::1".equals(normalized)) {
            return "host.docker.internal";
        }
        return host;
    }

    public record JdbcConnection(String url, String driver) {
    }
}
