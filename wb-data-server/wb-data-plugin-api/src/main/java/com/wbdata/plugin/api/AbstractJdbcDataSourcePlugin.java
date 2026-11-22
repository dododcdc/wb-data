package com.wbdata.plugin.api;

import com.wbdata.sql.SqlParameterTemplate;

import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.Driver;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.SQLFeatureNotSupportedException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * 基于 JDBC 的数据源插件抽象基类
 *
 * <p>
 * 默认情况下，各方法通过 {@link DriverManager} 创建原生 JDBC 连接。
 * 如需启用连接池，请通过 {@link #setConnectionSupplier(ConnectionSupplier)}
 * 注入一个 {@link ConnectionSupplier}——通常由后端的
 * {@code DataSourcePluginRegistry} 在插件加载完成后执行。
 *
 * <ul>
 * <li>{@code testConnectionDetailed}、{@code executeStatements} 始终绕过连接池，走直连 JDBC。</li>
 * <li>{@code getDatabases}、{@code getTables}、{@code getColumns}、{@code getTableDetail}、{@code executeQuery} 在有连接池时使用连接池。</li>
 * </ul>
 */
public abstract class AbstractJdbcDataSourcePlugin implements DataSourcePlugin {
    protected static final int DEFAULT_QUERY_ROW_LIMIT = 500;
    protected static final int DEFAULT_QUERY_TIMEOUT_SECONDS = 60;

    private static final Pattern HOST_PATTERN = Pattern.compile("^[A-Za-z0-9._:\\[\\]-]+$");
    private static final Pattern DATABASE_NAME_PATTERN = Pattern.compile("^[A-Za-z0-9_.$-]+$");
    private static final Pattern JDBC_PARAM_VALUE_PATTERN = Pattern.compile("^[A-Za-z0-9_./:+\\-,%]+$");

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
        Connection getConnection(
                DataSourceConnectionInfo connectionInfo,
                String jdbcUrl,
                String driverClassName,
                ClassLoader driverClassLoader)
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
    protected Connection getConnection(DataSourceConnectionInfo connectionInfo) throws Exception {
        ConnectionSupplier supplier = connectionSupplier;
        if (supplier != null) {
            return supplier.getConnection(
                    connectionInfo,
                    buildJdbcUrl(connectionInfo),
                    driverClassName(),
                    getClass().getClassLoader());
        }
        return openDirectConnection(connectionInfo);
    }

    // -------------------------------------------------------------------------
    // 插件接口实现
    // -------------------------------------------------------------------------

    @Override
    public ConnectionTestResult testConnectionDetailed(DataSourceConnectionInfo connectionInfo) {
        // 测试连接时始终使用直连——有意绕过连接池
        try (Connection ignored = openDirectConnection(connectionInfo)) {
            return ConnectionTestResult.success("连接成功");
        } catch (Exception e) {
            return ConnectionTestResult.failure(extractConnectionErrorMessage(e));
        }
    }

    @Override
    public void validateConnectionInfo(DataSourceConnectionInfo connectionInfo) {
        buildJdbcUrl(connectionInfo);
    }

    @Override
    public List<String> getDatabases(DataSourceConnectionInfo connectionInfo) {
        List<String> databases = new ArrayList<>();
        try (Connection connection = getConnection(connectionInfo)) {
            DatabaseMetaData metaData = connection.getMetaData();
            try (ResultSet rs = metaData.getCatalogs()) {
                while (rs.next()) {
                    databases.add(rs.getString("TABLE_CAT"));
                }
            }
            if (databases.isEmpty()) {
                try (ResultSet rs = metaData.getSchemas()) {
                    while (rs.next()) {
                        databases.add(rs.getString("TABLE_SCHEM"));
                    }
                }
            }
        } catch (Exception e) {
            throw new DataSourceException("获取数据库列表失败", e);
        }
        return prioritizeConfiguredDatabase(databases, connectionInfo.databaseName());
    }

    @Override
    public PageResult<TableSummary> getTables(DataSourceConnectionInfo connectionInfo, String databaseName, String keyword, int page, int size) {
        List<TableSummary> allMatched = new ArrayList<>();
        try (Connection connection = getConnection(connectionInfo)) {
            DatabaseMetaData metaData = connection.getMetaData();

            String normalizedKeyword = keyword == null ? null : keyword.trim().toLowerCase(Locale.ROOT);
            boolean hasKeyword = normalizedKeyword != null && !normalizedKeyword.isEmpty();

            try (ResultSet rs = metaData.getTables(databaseName, null, "%",
                    new String[] { "TABLE", "VIEW" })) {
                while (rs.next()) {
                    String tableName = rs.getString("TABLE_NAME");
                    if (hasKeyword && (tableName == null
                            || !tableName.toLowerCase(Locale.ROOT).contains(normalizedKeyword))) {
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

        return paginate(allMatched, page, size);
    }

    @Override
    public List<ColumnMetadata> getColumns(DataSourceConnectionInfo connectionInfo, String databaseName, String tableName) {
        Set<String> primaryKeys = new HashSet<>();
        try (Connection connection = getConnection(connectionInfo)) {
            DatabaseMetaData metaData = connection.getMetaData();

            try (ResultSet pkRs = metaData.getPrimaryKeys(databaseName, null, tableName)) {
                while (pkRs.next()) {
                    primaryKeys.add(pkRs.getString("COLUMN_NAME"));
                }
            } catch (Exception e) {
                // 某些驱动不支持 getPrimaryKeys，降级为全部当作非主键
            }

            List<ColumnMetadata> columns = new ArrayList<>();
            try (ResultSet colRs = metaData.getColumns(databaseName, null, tableName, "%")) {
                while (colRs.next()) {
                    String columnName = colRs.getString("COLUMN_NAME");
                    columns.add(new ColumnMetadata(
                            columnName,
                            colRs.getString("TYPE_NAME"),
                            colRs.getInt("COLUMN_SIZE"),
                            colRs.getInt("NULLABLE") == DatabaseMetaData.columnNullable,
                            colRs.getString("REMARKS"),
                            primaryKeys.contains(columnName)));
                }
            }
            return columns;
        } catch (Exception e) {
            throw new DataSourceException("获取字段列表失败: " + databaseName + "." + tableName, e);
        }
    }

    @Override
    public TableDetail getTableDetail(DataSourceConnectionInfo connectionInfo, String databaseName, String tableName) {
        return new TableDetail(getColumns(connectionInfo, databaseName, tableName), List.of(), false);
    }

    @Override
    public QueryResult executeQuery(QueryRequest request) {
        long startTime = System.currentTimeMillis();
        int rowLimit = resolveRowLimit(request.rowLimit());
        List<ColumnMetadata> capturedColumns = new ArrayList<>();
        List<Map<String, Object>> rows = new ArrayList<>();

        return runQueryStatement(request, rowLimit, (statement, hasResultSet) -> {
            if (!hasResultSet) {
                int updateCount = statement.getUpdateCount();
                return new QueryResult(
                        Collections.emptyList(),
                        Collections.emptyList(),
                        System.currentTimeMillis() - startTime,
                        "Affected rows: " + updateCount,
                        false,
                        rowLimit);
            }
            StreamOutcome outcome = consumeResultSet(statement, rowLimit, new QueryRowHandler() {
                @Override
                public void onColumns(List<ColumnMetadata> columns) {
                    capturedColumns.addAll(columns);
                }

                @Override
                public void onRow(List<Object> values) {
                    Map<String, Object> row = new LinkedHashMap<>();
                    for (int i = 0; i < capturedColumns.size(); i++) {
                        row.put(capturedColumns.get(i).name(), values.get(i));
                    }
                    rows.add(row);
                }
            });
            String message = outcome.truncated()
                    ? "Result truncated. Showing the first " + rowLimit + " rows."
                    : "Success";
            return new QueryResult(
                    capturedColumns,
                    rows,
                    System.currentTimeMillis() - startTime,
                    message,
                    outcome.truncated(),
                    rowLimit);
        });
    }

    @Override
    public QueryStreamSummary streamQuery(QueryRequest request, QueryRowHandler rowHandler) {
        if (rowHandler == null) {
            throw new IllegalArgumentException("rowHandler 不能为空");
        }
        long startTime = System.currentTimeMillis();
        int rowLimit = resolveRowLimit(request.rowLimit());
        return runQueryStatement(request, rowLimit, (statement, hasResultSet) -> {
            if (!hasResultSet) {
                rowHandler.onColumns(Collections.emptyList());
                return new QueryStreamSummary(0, false, System.currentTimeMillis() - startTime);
            }
            StreamOutcome outcome = consumeResultSet(statement, rowLimit, rowHandler);
            return new QueryStreamSummary(
                    outcome.rowCount(),
                    outcome.truncated(),
                    System.currentTimeMillis() - startTime);
        });
    }

    @FunctionalInterface
    private interface StatementResultHandler<T> {
        T handle(Statement statement, boolean hasResultSet) throws Exception;
    }

    private record StreamOutcome(int rowCount, boolean truncated) {
    }

    private <T> T runQueryStatement(QueryRequest request, int rowLimit, StatementResultHandler<T> handler) {
        DataSourceConnectionInfo connInfo = request.connectionInfo();
        int timeoutSeconds = resolveQueryTimeoutSeconds(request.timeoutSeconds());
        try (Connection connection = getConnection(connInfo)) {
            String previousCatalog = null;
            boolean catalogChanged = false;
            if (connInfo.databaseName() != null && !connInfo.databaseName().isEmpty()) {
                try {
                    previousCatalog = readCatalogQuietly(connection);
                    if (!connInfo.databaseName().equals(previousCatalog)) {
                        connection.setCatalog(connInfo.databaseName());
                        catalogChanged = true;
                    }
                } catch (Exception ignored) {
                    // 某些驱动不支持 setCatalog
                }
            }
            try (Statement statement = connection.createStatement()) {
                applyQueryTimeout(statement, timeoutSeconds);
                int fetchRowLimit = rowLimit < Integer.MAX_VALUE ? rowLimit + 1 : rowLimit;
                statement.setMaxRows(fetchRowLimit);
                boolean hasResultSet = statement.execute(request.sql());
                return handler.handle(statement, hasResultSet);
            } finally {
                if (catalogChanged && previousCatalog != null && !previousCatalog.equals(connInfo.databaseName())) {
                    restoreCatalogQuietly(connection, previousCatalog);
                }
            }
        } catch (Exception e) {
            throw new DataSourceException("执行查询失败: " + e.getMessage(), e);
        }
    }

    @Override
    public void executeStatements(DataSourceConnectionInfo connectionInfo, List<String> statements,
                                  Map<String, String> parameters, int timeoutSeconds) {
        if (statements.isEmpty()) {
            return;
        }
        // statementIndex 的语义由 SqlExecutionException 定义：1-based 的语句序号；
        // 连接建立或初始化失败时为 0。编译与执行共用同一序号——编译阶段缺参同样
        // 指向具体语句，调用方（传输前后置 SQL）按序号提示"第 N 条"。
        int statementIndex = 0;
        try {
            // 整阶段先编译并校验参数，避免后续语句缺参时前面的写入已自动提交。
            List<SqlParameterTemplate.Compilation> compiledStatements = new ArrayList<>();
            for (String sql : statements) {
                statementIndex++;
                SqlParameterTemplate.Compilation compiled = SqlParameterTemplate.compile(sql);
                for (String name : compiled.parameterNames()) {
                    if (parameters == null || parameters.get(name) == null) {
                        throw new IllegalArgumentException("SQL 参数未提供或为 null: " + name);
                    }
                }
                compiledStatements.add(compiled);
            }
            statementIndex = 0;
            // 连接池按数据源缓存，不能保证目标数据库隔离；同阶段始终使用一个新连接。
            try (Connection connection = openDirectConnection(connectionInfo)) {
                connection.setAutoCommit(true);
                for (SqlParameterTemplate.Compilation compiled : compiledStatements) {
                    statementIndex++;
                    try (PreparedStatement statement = connection.prepareStatement(compiled.jdbcSql())) {
                        statement.setQueryTimeout(timeoutSeconds);
                        for (int index = 0; index < compiled.parameterNames().size(); index++) {
                            statement.setString(index + 1, parameters.get(compiled.parameterNames().get(index)));
                        }
                        statement.execute();
                    }
                }
            }
        } catch (Exception e) {
            throw new SqlExecutionException(statementIndex, e);
        }
    }

    /**
     * 从 Statement 中读取 ResultSet，逐行触发回调而不在内存中整批缓存。
     * 仅在 {@code statement.execute()} 返回 true（即有结果集）时调用。
     */
    private StreamOutcome consumeResultSet(Statement statement, int rowLimit, QueryRowHandler rowHandler)
            throws Exception {
        try (ResultSet rs = statement.getResultSet()) {
            ResultSetMetaData rsMeta = rs.getMetaData();
            int colCount = rsMeta.getColumnCount();

            List<String> columnKeys = resolveColumnKeys(rsMeta, colCount);
            List<ColumnMetadata> columns = new ArrayList<>(colCount);
            for (int i = 1; i <= colCount; i++) {
                columns.add(new ColumnMetadata(
                        columnKeys.get(i - 1),
                        rsMeta.getColumnTypeName(i),
                        rsMeta.getPrecision(i),
                        rsMeta.isNullable(i) == ResultSetMetaData.columnNullable,
                        "",
                        false));
            }
            rowHandler.onColumns(Collections.unmodifiableList(columns));

            int rowCount = 0;
            boolean truncated = false;
            while (rs.next()) {
                if (rowCount >= rowLimit) {
                    truncated = true;
                    break;
                }
                List<Object> row = new ArrayList<>(colCount);
                for (int i = 1; i <= colCount; i++) {
                    row.add(rs.getObject(i));
                }
                rowHandler.onRow(Collections.unmodifiableList(row));
                rowCount++;
            }
            return new StreamOutcome(rowCount, truncated);
        }
    }

    private static List<String> resolveColumnKeys(ResultSetMetaData rsMeta, int colCount) throws SQLException {
        List<String> keys = new ArrayList<>(colCount);
        Set<String> usedKeys = new HashSet<>();
        for (int i = 1; i <= colCount; i++) {
            String label = rsMeta.getColumnLabel(i);
            String rawName = (label != null && !label.isBlank()) ? label : rsMeta.getColumnName(i);
            String base = (rawName != null && !rawName.isBlank()) ? rawName : "column_" + i;
            String uniqueKey = base;
            int suffix = 2;
            while (!usedKeys.add(uniqueKey)) {
                uniqueKey = base + "_" + suffix++;
            }
            keys.add(uniqueKey);
        }
        return keys;
    }

    private int resolveRowLimit(Integer requestedRowLimit) {
        if (requestedRowLimit == null || requestedRowLimit <= 0) {
            return DEFAULT_QUERY_ROW_LIMIT;
        }
        return requestedRowLimit;
    }

    private int resolveQueryTimeoutSeconds(Integer requestedTimeoutSeconds) {
        if (requestedTimeoutSeconds == null || requestedTimeoutSeconds <= 0) {
            return DEFAULT_QUERY_TIMEOUT_SECONDS;
        }
        return requestedTimeoutSeconds;
    }

    private void applyQueryTimeout(Statement statement, int timeoutSeconds) throws SQLException {
        try {
            statement.setQueryTimeout(timeoutSeconds);
        } catch (SQLFeatureNotSupportedException | UnsupportedOperationException | AbstractMethodError ignored) {
            // 驱动不支持 setQueryTimeout 时忽略
        } catch (SQLException e) {
            if (isUnsupportedTimeoutException(e)) {
                return;
            }
            throw e;
        }
    }

    private boolean isUnsupportedTimeoutException(SQLException exception) {
        String message = exception.getMessage();
        if (message == null) {
            return false;
        }
        String lower = message.toLowerCase(Locale.ROOT);
        return lower.contains("not supported") || lower.contains("unsupported");
    }

    private String readCatalogQuietly(Connection connection) {
        try {
            return connection.getCatalog();
        } catch (Exception ignored) {
            return null;
        }
    }

    private void restoreCatalogQuietly(Connection connection, String previousCatalog) {
        try {
            connection.setCatalog(previousCatalog);
        } catch (Exception ignored) {
            // 驱动不支持或连接已关闭时忽略
        }
    }

    // -------------------------------------------------------------------------
    // 工具辅助方法
    // -------------------------------------------------------------------------

    @Override
    public DialectMetadata getDialectMetadata() {
        return new DialectMetadata(
                List.of(
                        "SELECT", "FROM", "WHERE", "AND", "OR", "LIMIT", "ORDER BY", "GROUP BY",
                        "HAVING", "JOIN", "LEFT JOIN", "RIGHT JOIN", "INNER JOIN", "ON", "AS",
                        "INSERT", "UPDATE", "DELETE", "CREATE", "DROP", "ALTER", "TABLE", "DATABASE",
                        "IN", "IS", "NULL", "NOT", "EXISTS", "COUNT", "SUM", "AVG", "MIN", "MAX",
                        "DISTINCT", "UNION", "ALL", "CASE", "WHEN", "THEN", "ELSE", "END", "ASC", "DESC"),
                List.of(),
                List.of());
    }

    protected String emptyIfNull(String value) {
        return value == null ? "" : value;
    }

    protected List<String> prioritizeConfiguredDatabase(List<String> databases, String configuredDatabase) {
        List<String> normalized = new ArrayList<>();
        for (String database : databases) {
            if (database != null && !database.isBlank()) {
                normalized.add(database);
            }
        }

        if (configuredDatabase == null || configuredDatabase.isBlank()) {
            return normalized;
        }

        String preferred = configuredDatabase.trim();
        for (int index = 0; index < normalized.size(); index++) {
            String database = normalized.get(index);
            if (database.equalsIgnoreCase(preferred)) {
                normalized.remove(index);
                normalized.add(0, database);
                return normalized;
            }
        }

        normalized.add(0, preferred);
        return normalized;
    }

    private String extractConnectionErrorMessage(Exception exception) {
        Throwable current = exception;
        String message = null;

        while (current != null) {
            if (current.getMessage() != null && !current.getMessage().isBlank()) {
                message = current.getMessage();
            }
            current = current.getCause();
        }

        if (message == null || message.isBlank()) {
            return "连接失败，请检查地址、端口和认证信息";
        }

        return normalizeConnectionErrorMessage(message);
    }

    private String normalizeConnectionErrorMessage(String message) {
        String normalized = message.trim();
        String lowerCaseMessage = normalized.toLowerCase(Locale.ROOT);

        if (lowerCaseMessage.contains("connection refused")
                || lowerCaseMessage.contains("communications link failure")
                || lowerCaseMessage.contains("connection reset")) {
            return "无法建立连接，请检查主机地址、端口和数据库服务状态";
        }

        if (lowerCaseMessage.contains("timed out")
                || lowerCaseMessage.contains("timeout")
                || lowerCaseMessage.contains("socket timeout")) {
            return "连接超时，请检查网络连通性以及主机地址和端口";
        }

        if (lowerCaseMessage.contains("unknown host")
                || lowerCaseMessage.contains("unknownhostexception")) {
            return "无法解析主机地址，请检查主机名是否正确";
        }

        if (lowerCaseMessage.contains("access denied")
                || lowerCaseMessage.contains("authentication failed")
                || lowerCaseMessage.contains("password authentication failed")
                || lowerCaseMessage.contains("invalid authorization specification")) {
            return "认证失败，请检查用户名和密码是否正确";
        }

        if (lowerCaseMessage.contains("unknown database")
                || lowerCaseMessage.contains("database does not exist")
                || (lowerCaseMessage.contains("schema")
                    && lowerCaseMessage.contains("does not exist"))) {
            return "默认数据库不存在，请检查数据库名称是否正确";
        }

        if (lowerCaseMessage.contains("no suitable driver")
                || lowerCaseMessage.contains("failed to load driver class")
                || lowerCaseMessage.contains("classnotfoundexception")) {
            return "缺少对应数据库驱动，请检查插件安装是否完整";
        }

        if (lowerCaseMessage.contains("too many connections")) {
            return "数据库连接数已满，请稍后重试或检查数据库连接限制";
        }

        return "连接失败：" + normalized;
    }

    protected String defaultPort(Integer port, String fallback) {
        return port == null ? fallback : String.valueOf(port);
    }

    protected String defaultDatabase(String databaseName, String fallback) {
        return databaseName == null || databaseName.isBlank() ? fallback : databaseName;
    }

    /**
     * 校验数据库标识符是否只包含安全字符（字母、数字、下划线）。
     * 用于防止通过数据库名构造拼接 SQL 语句时引入注入风险。
     *
     * @throws DataSourceException 如果标识符包含非法字符
     */
    protected static void validateIdentifier(String identifier) {
        if (identifier != null && !identifier.matches("[a-zA-Z0-9_]+")) {
            throw new DataSourceException("数据库标识符包含非法字符: " + identifier);
        }
    }

    protected static String validateHost(String host) {
        if (host == null || host.isBlank()) {
            throw new DataSourceException("主机地址不能为空");
        }
        String trimmed = host.trim();
        if (!HOST_PATTERN.matcher(trimmed).matches()) {
            throw new DataSourceException("主机地址包含非法字符: " + host);
        }
        return trimmed;
    }

    protected static String validatePort(Integer port, String fallback) {
        if (port == null) {
            return fallback;
        }
        if (port < 1 || port > 65535) {
            throw new DataSourceException("端口号必须在 1 到 65535 之间");
        }
        return String.valueOf(port);
    }

    protected static String validateDatabaseName(String databaseName, String fallback) {
        if (databaseName == null || databaseName.isBlank()) {
            return fallback;
        }
        String trimmed = databaseName.trim();
        if (!DATABASE_NAME_PATTERN.matcher(trimmed).matches()) {
            throw new DataSourceException("数据库名称包含非法字符: " + databaseName);
        }
        return trimmed;
    }

    protected static String validateAndNormalizeJdbcParams(String rawParams, Set<String> allowedKeysLowerCase) {
        if (rawParams == null || rawParams.isBlank()) {
            return null;
        }
        String trimmed = rawParams.trim();
        if (trimmed.startsWith("?")
                || trimmed.indexOf('#') >= 0
                || trimmed.indexOf(';') >= 0
                || trimmed.indexOf('\0') >= 0
                || trimmed.chars().anyMatch(Character::isWhitespace)) {
            throw new DataSourceException("JDBC 连接参数包含非法字符");
        }
        String[] parts = trimmed.split("&", -1);
        List<String> normalizedParts = new ArrayList<>(parts.length);
        for (String part : parts) {
            int eq = part.indexOf('=');
            if (eq <= 0 || eq >= part.length() - 1) {
                throw new DataSourceException("JDBC 连接参数格式应为 key=value: " + part);
            }
            String key = part.substring(0, eq).trim();
            String value = part.substring(eq + 1).trim();
            if (!allowedKeysLowerCase.contains(key.toLowerCase(Locale.ROOT))) {
                throw new DataSourceException("不允许的 JDBC 连接参数: " + key);
            }
            if (!JDBC_PARAM_VALUE_PATTERN.matcher(value).matches()) {
                throw new DataSourceException("JDBC 连接参数值包含非法字符: " + key);
            }
            normalizedParts.add(key + "=" + value);
        }
        return String.join("&", normalizedParts);
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

    /** 内存分页：JDBC 元数据接口无原生分页，全量取回后切页。 */
    protected static <T> PageResult<T> paginate(List<T> allMatched, int page, int size) {
        int total = allMatched.size();
        int safePage = Math.max(page, 1);
        int safeSize = size > 0 ? size : 200;
        int fromIndex = Math.min((safePage - 1) * safeSize, total);
        int toIndex = Math.min(fromIndex + safeSize, total);
        return new PageResult<>(new ArrayList<>(allMatched.subList(fromIndex, toIndex)), total, safePage, safeSize);
    }
}
