package com.wbdata.plugin.postgresql;

import com.wbdata.plugin.api.AbstractJdbcDataSourcePlugin;
import com.wbdata.plugin.api.ColumnMetadata;
import com.wbdata.plugin.api.DataSourceConnectionInfo;
import com.wbdata.plugin.api.DataSourceException;
import com.wbdata.plugin.api.DataSourcePluginDescriptor;
import com.wbdata.plugin.api.PageResult;
import com.wbdata.plugin.api.PluginFieldDescriptor;
import com.wbdata.plugin.api.TableSummary;

import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

public final class PostgreSqlDataSourcePlugin extends AbstractJdbcDataSourcePlugin {

    private static final String DEFAULT_DATABASE = "postgres";
    private static final String DEFAULT_SCHEMA = "public";
    private static final String PG_DATABASES_SQL =
            "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname";

    private static final Set<String> ALLOWED_JDBC_PARAMS = Set.of(
            "ssl",
            "sslmode",
            "currentschema",
            "connecttimeout",
            "sockettimeout",
            "logintimeout",
            "tcpkeepalive",
            "applicationname",
            "preparethreshold",
            "rewritebatchedinserts",
            "stringtype"
    );

    private static final DataSourcePluginDescriptor DESCRIPTOR = new DataSourcePluginDescriptor(
            "POSTGRESQL",
            "PostgreSQL",
            40,
            "适合事务型 PostgreSQL 实例，默认端口 5432。",
            true,
            List.of(
                    new PluginFieldDescriptor("host", "connection", "主机名 / IP 地址", "127.0.0.1", "text", true, null),
                    new PluginFieldDescriptor("port", "connection", "端口", "5432", "text", true, "5432"),
                    new PluginFieldDescriptor("databaseName", "connection", "默认数据库", "如：postgres", "text", true, null),
                    new PluginFieldDescriptor("username", "authentication", "用户名", "postgres", "text", true, null),
                    new PluginFieldDescriptor("password", "authentication", "密码", "请输入数据库密码", "password", false, null)
            )
    );

    @Override
    public DataSourcePluginDescriptor descriptor() {
        return DESCRIPTOR;
    }

    @Override
    protected String driverClassName() {
        return "org.postgresql.Driver";
    }

    @Override
    protected String buildJdbcUrl(DataSourceConnectionInfo connectionInfo) {
        String jdbcParams = validateAndNormalizeJdbcParams(
                connectionParam(connectionInfo.connectionParams(), "jdbcParams"),
                ALLOWED_JDBC_PARAMS
        );
        String suffix = jdbcParams == null ? "" : "?" + jdbcParams;
        return String.format(
                "jdbc:postgresql://%s:%s/%s%s",
                validateHost(connectionInfo.host()),
                validatePort(connectionInfo.port(), "5432"),
                validateDatabaseName(connectionInfo.databaseName(), DEFAULT_DATABASE),
                suffix
        );
    }

    @Override
    public List<String> getDatabases(DataSourceConnectionInfo connectionInfo) {
        List<String> databases = new ArrayList<>();
        try (Connection connection = getConnection(connectionInfo);
             Statement statement = connection.createStatement();
             ResultSet rs = statement.executeQuery(PG_DATABASES_SQL)) {
            while (rs.next()) {
                databases.add(rs.getString(1));
            }
            return prioritizeConfiguredDatabase(databases, connectionInfo.databaseName());
        } catch (Exception ignored) {
            return super.getDatabases(connectionInfo);
        }
    }

    @Override
    public PageResult<TableSummary> getTables(DataSourceConnectionInfo connectionInfo,
                                              String databaseName,
                                              String keyword,
                                              int page,
                                              int size) {
        DataSourceConnectionInfo scopedInfo = withDatabase(connectionInfo, databaseName);
        String targetDb = defaultDatabase(scopedInfo.databaseName(), DEFAULT_DATABASE);
        String defaultSchema = resolveDefaultSchema(scopedInfo);
        String normalizedKeyword = keyword == null ? null : keyword.trim().toLowerCase(Locale.ROOT);
        boolean hasKeyword = normalizedKeyword != null && !normalizedKeyword.isEmpty();

        List<TableSummary> allMatched = new ArrayList<>();
        try (Connection connection = getConnection(scopedInfo)) {
            DatabaseMetaData metaData = connection.getMetaData();
            try (ResultSet rs = metaData.getTables(targetDb, null, "%", new String[]{"TABLE", "VIEW"})) {
                while (rs.next()) {
                    String schema = rs.getString("TABLE_SCHEM");
                    if (isSystemSchema(schema)) {
                        continue;
                    }
                    String rawTable = rs.getString("TABLE_NAME");
                    if (rawTable == null || rawTable.isBlank()) {
                        continue;
                    }
                    String displayName = (schema == null || schema.isBlank() || schema.equalsIgnoreCase(defaultSchema))
                            ? rawTable
                            : schema + "." + rawTable;
                    if (hasKeyword && !displayName.toLowerCase(Locale.ROOT).contains(normalizedKeyword)) {
                        continue;
                    }
                    allMatched.add(new TableSummary(displayName, rs.getString("TABLE_TYPE"), rs.getString("REMARKS")));
                }
            }
        } catch (Exception e) {
            throw new DataSourceException("获取表列表失败: " + targetDb, e);
        }

        return paginate(allMatched, page, size);
    }

    @Override
    public List<ColumnMetadata> getColumns(DataSourceConnectionInfo connectionInfo,
                                           String databaseName,
                                           String tableName) {
        DataSourceConnectionInfo scopedInfo = withDatabase(connectionInfo, databaseName);
        String targetDb = defaultDatabase(scopedInfo.databaseName(), DEFAULT_DATABASE);
        String defaultSchema = resolveDefaultSchema(scopedInfo);

        int dotIndex = tableName == null ? -1 : tableName.indexOf('.');
        boolean explicitSchema = dotIndex > 0 && dotIndex < tableName.length() - 1;
        String schemaPattern = explicitSchema ? tableName.substring(0, dotIndex) : defaultSchema;
        String bareTableName = explicitSchema ? tableName.substring(dotIndex + 1) : tableName;

        try (Connection connection = getConnection(scopedInfo)) {
            DatabaseMetaData metaData = connection.getMetaData();
            List<ColumnMetadata> columns = readColumns(metaData, targetDb, schemaPattern, bareTableName, false);
            if (columns.isEmpty() && !explicitSchema) {
                columns = readColumns(metaData, targetDb, null, bareTableName, true);
            }
            return columns;
        } catch (Exception e) {
            throw new DataSourceException("获取字段列表失败: " + targetDb + "." + tableName, e);
        }
    }

    private List<ColumnMetadata> readColumns(DatabaseMetaData metaData,
                                             String catalog,
                                             String schemaPattern,
                                             String tableName,
                                             boolean excludeSystemSchemas) throws Exception {
        Set<String> primaryKeys = new HashSet<>();
        try (ResultSet pkRs = metaData.getPrimaryKeys(catalog, schemaPattern, tableName)) {
            while (pkRs.next()) {
                if (excludeSystemSchemas && isSystemSchema(readColumnQuietly(pkRs, "TABLE_SCHEM"))) {
                    continue;
                }
                primaryKeys.add(pkRs.getString("COLUMN_NAME"));
            }
        } catch (Exception ignored) {
            // 某些驱动或权限场景不支持 getPrimaryKeys，降级为全部非主键
        }

        List<ColumnMetadata> columns = new ArrayList<>();
        try (ResultSet colRs = metaData.getColumns(catalog, schemaPattern, tableName, "%")) {
            while (colRs.next()) {
                if (excludeSystemSchemas && isSystemSchema(readColumnQuietly(colRs, "TABLE_SCHEM"))) {
                    continue;
                }
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
    }

    private static String readColumnQuietly(ResultSet rs, String columnLabel) {
        try {
            return rs.getString(columnLabel);
        } catch (Exception ignored) {
            return null;
        }
    }

    private DataSourceConnectionInfo withDatabase(DataSourceConnectionInfo info, String databaseName) {
        if (databaseName == null || databaseName.isBlank()) {
            return info;
        }
        String trimmed = databaseName.trim();
        if (trimmed.equals(info.databaseName())) {
            return info;
        }
        return new DataSourceConnectionInfo(
                info.dataSourceId(),
                info.type(),
                info.host(),
                info.port(),
                trimmed,
                info.username(),
                info.password(),
                info.connectionParams());
    }

    private static boolean isSystemSchema(String schema) {
        if (schema == null || schema.isBlank()) {
            return false;
        }
        String lower = schema.trim().toLowerCase(Locale.ROOT);
        return "pg_catalog".equals(lower)
                || "information_schema".equals(lower)
                || "pg_toast".equals(lower)
                || lower.startsWith("pg_temp_")
                || lower.startsWith("pg_toast_temp_");
    }

    private String resolveDefaultSchema(DataSourceConnectionInfo info) {
        String rawParams = connectionParam(info.connectionParams(), "jdbcParams");
        if (rawParams == null) {
            return DEFAULT_SCHEMA;
        }
        for (String part : rawParams.split("&")) {
            int eq = part.indexOf('=');
            if (eq > 0 && "currentschema".equalsIgnoreCase(part.substring(0, eq).trim())) {
                String value = part.substring(eq + 1).trim();
                for (String candidate : value.split(",")) {
                    String trimmed = candidate.trim();
                    if (!trimmed.isEmpty()) {
                        return trimmed;
                    }
                }
            }
        }
        return DEFAULT_SCHEMA;
    }
}
