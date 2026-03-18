package com.wbdata.plugin.api;

import java.sql.Connection;
import java.sql.Driver;
import java.sql.DriverManager;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 基于 JDBC 的数据源插件抽象基类
 * 
 * <p>
 * 默认情况下，各方法通过 {@link DriverManager} 创建原生 JDBC 连接。
 * 如需启用连接池，请通过 {@link #setConnectionSupplier(ConnectionSupplier)} 
 * 注入一个 {@link ConnectionSupplier}——通常由后端的
 * {@code DataSourceConnectionPoolManager} 在插件加载完成后执行。
 *
 * <ul>
 * <li>{@code testConnection} 始终绕过连接池（必须验证新的连通性）。</li>
 * <li>{@code getDatabases}、{@code getTables}、{@code executeQuery} 在有连接池时使用连接池。</li>
 * </ul>
 */
public abstract class AbstractJdbcDataSourcePlugin implements DataSourcePlugin {

    private static final Set<String> REGISTERED_DRIVERS = ConcurrentHashMap.newKeySet();

    /**
     * 由后端提供的函数式接口，用于提供池化连接。
     * 实现应内部使用 HikariCP。
     */
    @FunctionalInterface
    public interface ConnectionSupplier {
        /**
         * 返回给定请求的活跃 JDBC 连接。
         * 调用方负责关闭它（将连接归还到池中）。
         */
        Connection getConnection(DataSourceConnectionInfo connectionInfo, String jdbcUrl, String driverClassName)
                throws Exception;
    }

    /**
     * 可选的池化连接供应器。为 null 时回退到 {@link DriverManager}。
     * 由后端在所有插件加载完成后设置。
     */
    private static volatile ConnectionSupplier connectionSupplier;

    /**
     * 为所有插件实例注入一个池化连接供应器
     * （通过静态字段共享，以跨越所有 ClassLoader 实例）。
     */
    public static void setConnectionSupplier(ConnectionSupplier supplier) {
        connectionSupplier = supplier;
    }

    protected abstract String driverClassName();

    protected abstract String buildJdbcUrl(DataSourceConnectionInfo connectionInfo);

    // -------------------------------------------------------------------------
    // 内部辅助方法
    // -------------------------------------------------------------------------

    /**
     * 始终通过 DriverManager 创建新连接——仅用于连接测试。
     */
    private Connection openDirectConnection(DataSourceConnectionInfo connectionInfo) throws Exception {
        registerDriverIfNeeded(driverClassName(), getClass().getClassLoader());
        return DriverManager.getConnection(
                buildJdbcUrl(connectionInfo),
                emptyIfNull(connectionInfo.username()),
                emptyIfNull(connectionInfo.password()));
    }

    /**
     * 返回连接：如果有供应器则使用池化连接，否则使用直连。
     */
    private Connection getConnection(DataSourceConnectionInfo connectionInfo) throws Exception {
        ConnectionSupplier supplier = connectionSupplier;
        if (supplier != null) {
            return supplier.getConnection(connectionInfo, buildJdbcUrl(connectionInfo), driverClassName());
        }
        return openDirectConnection(connectionInfo);
    }

    // -------------------------------------------------------------------------
    // 插件接口实现
    // -------------------------------------------------------------------------

    @Override
    public boolean testConnection(DataSourceConnectionInfo connectionInfo) {
        // 测试连接时始终使用直连——有意绕过连接池
        try (Connection ignored = openDirectConnection(connectionInfo)) {
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    @Override
    public java.util.List<String> getDatabases(DataSourceConnectionInfo connectionInfo) {
        java.util.List<String> databases = new java.util.ArrayList<>();
        try (Connection connection = getConnection(connectionInfo)) {
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
            throw new DataSourceException("获取数据库列表失败", e);
        }
        return databases;
    }

    @Override
    public PageResult<TableSummary> getTables(DataSourceConnectionInfo connectionInfo, String databaseName, String keyword, int page, int size) {
        java.util.List<TableSummary> allMatched = new java.util.ArrayList<>();
        try (Connection connection = getConnection(connectionInfo)) {
            java.sql.DatabaseMetaData metaData = connection.getMetaData();

            String normalizedKeyword = keyword == null ? null : keyword.trim().toLowerCase(java.util.Locale.ROOT);
            boolean hasKeyword = normalizedKeyword != null && !normalizedKeyword.isEmpty();

            try (java.sql.ResultSet rs = metaData.getTables(databaseName, null, "%",
                    new String[] { "TABLE", "VIEW" })) {
                while (rs.next()) {
                    String tableName = rs.getString("TABLE_NAME");
                    if (hasKeyword && (tableName == null
                            || !tableName.toLowerCase(java.util.Locale.ROOT).contains(normalizedKeyword))) {
                        continue;
                    }
                    String tableType = rs.getString("TABLE_TYPE");
                    String remarks = rs.getString("REMARKS");
                    allMatched.add(new TableSummary(tableName, tableType, remarks));
                }
            }
        } catch (Exception e) {
            throw new DataSourceException("获取表列表失败: " + databaseName, e);
        }

        int total = allMatched.size();
        int safePage = Math.max(page, 1);
        int safeSize = size > 0 ? size : 200;
        int fromIndex = Math.min((safePage - 1) * safeSize, total);
        int toIndex = Math.min(fromIndex + safeSize, total);
        java.util.List<TableSummary> data = new java.util.ArrayList<>(allMatched.subList(fromIndex, toIndex));
        return new PageResult<>(data, total, safePage, safeSize);
    }

    @Override
    public java.util.List<ColumnMetadata> getColumns(DataSourceConnectionInfo connectionInfo, String databaseName, String tableName) {
        java.util.List<ColumnMetadata> columns = new java.util.ArrayList<>();
        try (Connection connection = getConnection(connectionInfo)) {
            java.sql.DatabaseMetaData metaData = connection.getMetaData();
            try (java.sql.ResultSet colRs = metaData.getColumns(databaseName, null, tableName, "%")) {
                while (colRs.next()) {
                    columns.add(new ColumnMetadata(
                            colRs.getString("COLUMN_NAME"),
                            colRs.getString("TYPE_NAME"),
                            colRs.getInt("COLUMN_SIZE"),
                            colRs.getInt("NULLABLE") == java.sql.DatabaseMetaData.columnNullable,
                            colRs.getString("REMARKS"),
                            false));
                }
            }
        } catch (Exception e) {
            throw new DataSourceException("获取字段列表失败: " + databaseName + "." + tableName, e);
        }
        return columns;
    }

    @Override
    public QueryResult executeQuery(QueryRequest request) {
        long startTime = System.currentTimeMillis();
        DataSourceConnectionInfo connInfo = request.connectionInfo();
        try (Connection connection = getConnection(connInfo)) {
            if (connInfo.databaseName() != null && !connInfo.databaseName().isEmpty()) {
                try {
                    connection.setCatalog(connInfo.databaseName());
                } catch (Exception ignored) {
                    // 某些驱动不支持 setCatalog
                }
            }
            try (java.sql.Statement statement = connection.createStatement()) {
                boolean hasResultSet = statement.execute(request.sql());
                if (hasResultSet) {
                    return buildQueryResult(statement, startTime);
                } else {
                    int updateCount = statement.getUpdateCount();
                    return new QueryResult(
                            java.util.Collections.emptyList(),
                            java.util.Collections.emptyList(),
                            System.currentTimeMillis() - startTime,
                            "Affected rows: " + updateCount);
                }
            }
        } catch (Exception e) {
            throw new DataSourceException("执行查询失败: " + e.getMessage(), e);
        }
    }

    /**
     * 从 Statement 中读取 ResultSet，解析列信息和行数据，封装为 QueryResult。
     * 仅在 {@code statement.execute()} 返回 true（即有结果集）时调用。
     */
    private QueryResult buildQueryResult(java.sql.Statement statement, long startTime) throws java.sql.SQLException {
        try (java.sql.ResultSet rs = statement.getResultSet()) {
            java.sql.ResultSetMetaData rsMeta = rs.getMetaData();
            int colCount = rsMeta.getColumnCount();

            java.util.List<ColumnMetadata> columns = new java.util.ArrayList<>();
            for (int i = 1; i <= colCount; i++) {
                columns.add(new ColumnMetadata(
                        rsMeta.getColumnName(i),
                        rsMeta.getColumnTypeName(i),
                        rsMeta.getPrecision(i),
                        rsMeta.isNullable(i) == java.sql.ResultSetMetaData.columnNullable,
                        "",
                        false));
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
    }

    // -------------------------------------------------------------------------
    // 工具辅助方法
    // -------------------------------------------------------------------------

    @Override
    public DialectMetadata getDialectMetadata() {
        return new DialectMetadata(
                java.util.List.of(
                        "SELECT", "FROM", "WHERE", "AND", "OR", "LIMIT", "ORDER BY", "GROUP BY",
                        "HAVING", "JOIN", "LEFT JOIN", "RIGHT JOIN", "INNER JOIN", "ON", "AS",
                        "INSERT", "UPDATE", "DELETE", "CREATE", "DROP", "ALTER", "TABLE", "DATABASE",
                        "IN", "IS", "NULL", "NOT", "EXISTS", "COUNT", "SUM", "AVG", "MIN", "MAX",
                        "DISTINCT", "UNION", "ALL", "CASE", "WHEN", "THEN", "ELSE", "END", "ASC", "DESC"),
                java.util.List.of(),
                java.util.List.of());
    }

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
        if (params == null || key == null)
            return null;
        Object value = params.get(key);
        if (value == null)
            return null;
        String s = String.valueOf(value).trim();
        return s.isEmpty() ? null : s;
    }

    private void registerDriverIfNeeded(String driverClassName, ClassLoader classLoader) throws Exception {
        String registrationKey = driverClassName + '@' + System.identityHashCode(classLoader);
        if (REGISTERED_DRIVERS.contains(registrationKey))
            return;

        synchronized (REGISTERED_DRIVERS) {
            if (REGISTERED_DRIVERS.contains(registrationKey))
                return;
            Driver driver = (Driver) Class.forName(driverClassName, true, classLoader)
                    .getDeclaredConstructor()
                    .newInstance();
            DriverManager.registerDriver(new DriverShim(driver));
            REGISTERED_DRIVERS.add(registrationKey);
        }
    }
}
