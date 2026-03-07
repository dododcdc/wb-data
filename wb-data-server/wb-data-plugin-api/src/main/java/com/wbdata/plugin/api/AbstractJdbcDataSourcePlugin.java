package com.wbdata.plugin.api;

import java.sql.Connection;
import java.sql.Driver;
import java.sql.DriverManager;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Base class for all JDBC-based data source plugins.
 *
 * <p>By default, individual methods create raw JDBC connections via {@link DriverManager}.
 * To enable connection pooling, inject a {@link ConnectionSupplier} via
 * {@link #setConnectionSupplier(ConnectionSupplier)} — typically done by the backend's
 * {@code DataSourceConnectionPoolManager} after plugins are loaded.
 *
 * <ul>
 *   <li>{@code testConnection} always bypasses the pool (it must validate fresh connectivity).</li>
 *   <li>{@code getDatabases}, {@code getTables}, {@code executeQuery} use the pool when available.</li>
 * </ul>
 */
public abstract class AbstractJdbcDataSourcePlugin implements DataSourcePlugin {

    private static final Set<String> REGISTERED_DRIVERS = ConcurrentHashMap.newKeySet();

    /**
     * Functional interface supplied by the backend to provide pooled connections.
     * The implementation is expected to use HikariCP under the hood.
     */
    @FunctionalInterface
    public interface ConnectionSupplier {
        /**
         * Returns a live JDBC connection for the given request.
         * Callers are responsible for closing it (returning it to the pool).
         */
        Connection getConnection(ConnectionTestRequest request, String jdbcUrl, String driverClassName) throws Exception;
    }

    /**
     * Optional pooled connection supplier. Null means fall back to {@link DriverManager}.
     * Set by the backend after all plugins are loaded.
     */
    private static volatile ConnectionSupplier connectionSupplier;

    /**
     * Injects a pooled connection supplier for all plugin instances
     * (shared via static field to span all ClassLoader instances).
     */
    public static void setConnectionSupplier(ConnectionSupplier supplier) {
        connectionSupplier = supplier;
    }

    protected abstract String driverClassName();

    protected abstract String buildJdbcUrl(ConnectionTestRequest request);

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    /**
     * Always creates a fresh connection via DriverManager — used only for connectivity tests.
     */
    private Connection openDirectConnection(ConnectionTestRequest request) throws Exception {
        registerDriverIfNeeded(driverClassName(), getClass().getClassLoader());
        return DriverManager.getConnection(
                buildJdbcUrl(request),
                emptyIfNull(request.username()),
                emptyIfNull(request.password()));
    }

    /**
     * Returns a connection: pooled if a supplier has been set, direct otherwise.
     */
    private Connection getConnection(ConnectionTestRequest request) throws Exception {
        ConnectionSupplier supplier = connectionSupplier;
        if (supplier != null) {
            return supplier.getConnection(request, buildJdbcUrl(request), driverClassName());
        }
        return openDirectConnection(request);
    }

    // -------------------------------------------------------------------------
    // Plugin interface implementations
    // -------------------------------------------------------------------------

    @Override
    public boolean testConnection(ConnectionTestRequest request) {
        // Always use a direct connection for tests — bypassing the pool intentionally.
        try (Connection ignored = openDirectConnection(request)) {
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    @Override
    public java.util.List<String> getDatabases(ConnectionTestRequest request) {
        java.util.List<String> databases = new java.util.ArrayList<>();
        try (Connection connection = getConnection(request)) {
            java.sql.DatabaseMetaData metaData = connection.getMetaData();
            try (java.sql.ResultSet rs = metaData.getCatalogs()) {
                while (rs.next()) {
                    databases.add(rs.getString("TABLE_CAT"));
                }
            }
            if (databases.isEmpty()) {
                try (java.sql.ResultSet rs = metaData.getSchemas()) {
                    while (rs.next()) {
                        databases.add(rs.getString("TABLE_SCHEM"));
                    }
                }
            }
        } catch (Exception e) {
            throw new RuntimeException("Failed to fetch databases", e);
        }
        return databases;
    }

    @Override
    public java.util.List<TableMetadata> getTables(ConnectionTestRequest request, String databaseName) {
        java.util.List<TableMetadata> tables = new java.util.ArrayList<>();
        try (Connection connection = getConnection(request)) {
            java.sql.DatabaseMetaData metaData = connection.getMetaData();
            try (java.sql.ResultSet rs = metaData.getTables(databaseName, null, "%", new String[]{"TABLE", "VIEW"})) {
                while (rs.next()) {
                    String tableName = rs.getString("TABLE_NAME");
                    String tableType = rs.getString("TABLE_TYPE");
                    String remarks   = rs.getString("REMARKS");

                    java.util.List<ColumnMetadata> columns = new java.util.ArrayList<>();
                    try (java.sql.ResultSet colRs = metaData.getColumns(databaseName, null, tableName, "%")) {
                        while (colRs.next()) {
                            columns.add(new ColumnMetadata(
                                    colRs.getString("COLUMN_NAME"),
                                    colRs.getString("TYPE_NAME"),
                                    colRs.getInt("COLUMN_SIZE"),
                                    colRs.getInt("NULLABLE") == java.sql.DatabaseMetaData.columnNullable,
                                    colRs.getString("REMARKS"),
                                    false
                            ));
                        }
                    }
                    tables.add(new TableMetadata(tableName, tableType, remarks, columns));
                }
            }
        } catch (Exception e) {
            throw new RuntimeException("Failed to fetch tables of " + databaseName, e);
        }
        return tables;
    }

    @Override
    public QueryResult executeQuery(QueryRequest request) {
        long startTime = System.currentTimeMillis();
        ConnectionTestRequest connInfo = new ConnectionTestRequest(
                request.dataSourceId(), request.type(), request.host(), request.port(), request.databaseName(),
                request.username(), request.password(), request.connectionParams()
        );
        try (Connection connection = getConnection(connInfo)) {
            if (request.databaseName() != null && !request.databaseName().isEmpty()) {
                try {
                    connection.setCatalog(request.databaseName());
                } catch (Exception ignored) {
                    // Some drivers do not support setCatalog
                }
            }
            try (java.sql.Statement statement = connection.createStatement()) {
                boolean hasResultSet = statement.execute(request.sql());
                if (hasResultSet) {
                    try (java.sql.ResultSet rs = statement.getResultSet()) {
                        java.sql.ResultSetMetaData rsMeta = rs.getMetaData();
                        int colCount = rsMeta.getColumnCount();

                        java.util.List<ColumnMetadata> columns = new java.util.ArrayList<>();
                        for (int i = 1; i <= colCount; i++) {
                            columns.add(new ColumnMetadata(
                                    rsMeta.getColumnName(i),
                                    rsMeta.getColumnTypeName(i),
                                    rsMeta.getPrecision(i),
                                    rsMeta.isNullable(i) != java.sql.ResultSetMetaData.columnNoNulls,
                                    "",
                                    false
                            ));
                        }
                        java.util.List<java.util.Map<String, Object>> rows = new java.util.ArrayList<>();
                        while (rs.next()) {
                            java.util.Map<String, Object> row = new java.util.LinkedHashMap<>();
                            for (int i = 1; i <= colCount; i++) {
                                row.put(rsMeta.getColumnName(i), rs.getObject(i));
                            }
                            rows.add(row);
                        }
                        return new QueryResult(columns, rows, System.currentTimeMillis() - startTime, "Success");
                    }
                } else {
                    int updateCount = statement.getUpdateCount();
                    return new QueryResult(
                            java.util.Collections.emptyList(),
                            java.util.Collections.emptyList(),
                            System.currentTimeMillis() - startTime,
                            "Affected rows: " + updateCount
                    );
                }
            }
        } catch (Exception e) {
            return new QueryResult(
                    java.util.Collections.emptyList(),
                    java.util.Collections.emptyList(),
                    System.currentTimeMillis() - startTime,
                    "Error: " + e.getMessage()
            );
        }
    }

    // -------------------------------------------------------------------------
    // Utility helpers
    // -------------------------------------------------------------------------

    protected String emptyIfNull(String value) {
        return value == null ? "" : value;
    }

    protected String defaultPort(Integer port, String fallback) {
        return port == null ? fallback : String.valueOf(port);
    }

    protected String defaultDatabase(String databaseName, String fallback) {
        return databaseName == null || databaseName.isBlank() ? fallback : databaseName;
    }

    protected String connectionParam(Map<String, Object> params, String key) {
        if (params == null || key == null) return null;
        Object value = params.get(key);
        if (value == null) return null;
        String s = String.valueOf(value).trim();
        return s.isEmpty() ? null : s;
    }

    private void registerDriverIfNeeded(String driverClassName, ClassLoader classLoader) throws Exception {
        String registrationKey = driverClassName + '@' + System.identityHashCode(classLoader);
        if (REGISTERED_DRIVERS.contains(registrationKey)) return;

        synchronized (REGISTERED_DRIVERS) {
            if (REGISTERED_DRIVERS.contains(registrationKey)) return;
            Driver driver = (Driver) Class.forName(driverClassName, true, classLoader)
                    .getDeclaredConstructor()
                    .newInstance();
            DriverManager.registerDriver(new DriverShim(driver));
            REGISTERED_DRIVERS.add(registrationKey);
        }
    }
}

