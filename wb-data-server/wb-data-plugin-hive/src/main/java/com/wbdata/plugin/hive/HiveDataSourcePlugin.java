package com.wbdata.plugin.hive;

import com.wbdata.plugin.api.AbstractJdbcDataSourcePlugin;
import com.wbdata.plugin.api.ColumnMetadata;
import com.wbdata.plugin.api.DataSourceException;
import com.wbdata.plugin.api.DataSourceConnectionInfo;
import com.wbdata.plugin.api.DataSourcePluginDescriptor;
import com.wbdata.plugin.api.PageResult;
import com.wbdata.plugin.api.PartitionColumnMetadata;
import com.wbdata.plugin.api.PluginFieldDescriptor;
import com.wbdata.plugin.api.TableDetail;
import com.wbdata.plugin.api.TableSummary;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public final class HiveDataSourcePlugin extends AbstractJdbcDataSourcePlugin {

    private static final DataSourcePluginDescriptor DESCRIPTOR = new DataSourcePluginDescriptor(
            "HIVE",
            "Hive",
            20,
            "当前版本通过 HiveServer2 Binary 直连，默认端口 10000。",
            true,
            List.of(
                    new PluginFieldDescriptor("host", "connection", "HiveServer2 地址", "hive-server.example.com", "text", true, null),
                    new PluginFieldDescriptor("port", "connection", "端口", "10000", "text", true, "10000"),
                    new PluginFieldDescriptor("databaseName", "connection", "默认数据库", "如：default", "text", true, "default"),
                    new PluginFieldDescriptor("metastoreUri", "connectionParams", "Hive Metastore URI", "thrift://host.docker.internal:9083", "text", false, null),
                    new PluginFieldDescriptor("username", "authentication", "用户名", "hive_user", "text", true, null),
                    new PluginFieldDescriptor("password", "authentication", "密码", "未配置密码可留空", "password", false, null)
            )
    );

    @Override
    public DataSourcePluginDescriptor descriptor() {
        return DESCRIPTOR;
    }

    @Override
    protected String driverClassName() {
        return "org.apache.hive.jdbc.HiveDriver";
    }

    @Override
    protected String buildJdbcUrl(DataSourceConnectionInfo connectionInfo) {
        return String.format(
                "jdbc:hive2://%s:%s/%s",
                connectionInfo.host(),
                defaultPort(connectionInfo.port(), "10000"),
                defaultDatabase(connectionInfo.databaseName(), "default")
        );
    }

    @Override
    public List<String> getDatabases(DataSourceConnectionInfo connectionInfo) {
        List<String> databases = new ArrayList<>();
        try (Connection connection = getConnection(connectionInfo);
             Statement statement = connection.createStatement();
             ResultSet resultSet = statement.executeQuery("SHOW DATABASES")) {
            while (resultSet.next()) {
                databases.add(resultSet.getString(1));
            }
        } catch (Exception e) {
            throw new DataSourceException("获取 Hive 数据库列表失败", e);
        }
        return prioritizeConfiguredDatabase(databases, connectionInfo.databaseName());
    }

    @Override
    public PageResult<TableSummary> getTables(DataSourceConnectionInfo connectionInfo, String databaseName, String keyword, int page, int size) {
        validateIdentifier(databaseName);
        String resolvedDatabase = resolveDatabaseName(connectionInfo, databaseName);
        List<TableSummary> allTables = new ArrayList<>();
        String normalizedKeyword = keyword == null ? null : keyword.trim().toLowerCase(Locale.ROOT);
        boolean hasKeyword = normalizedKeyword != null && !normalizedKeyword.isEmpty();

        try (Connection connection = getConnection(connectionInfo);
             Statement statement = connection.createStatement();
             ResultSet resultSet = statement.executeQuery("SHOW TABLES IN " + quoteIdentifier(resolvedDatabase))) {
            while (resultSet.next()) {
                String tableName = resultSet.getString(1);
                if (tableName == null || tableName.isBlank()) {
                    continue;
                }
                if (hasKeyword && !tableName.toLowerCase(Locale.ROOT).contains(normalizedKeyword)) {
                    continue;
                }
                allTables.add(new TableSummary(tableName, "TABLE", ""));
            }
        } catch (Exception e) {
            throw new DataSourceException("获取 Hive 表列表失败: " + resolvedDatabase, e);
        }

        int total = allTables.size();
        int safePage = Math.max(page, 1);
        int safeSize = size > 0 ? size : 200;
        int fromIndex = Math.min((safePage - 1) * safeSize, total);
        int toIndex = Math.min(fromIndex + safeSize, total);
        return new PageResult<>(new ArrayList<>(allTables.subList(fromIndex, toIndex)), total, safePage, safeSize);
    }

    @Override
    public List<ColumnMetadata> getColumns(DataSourceConnectionInfo connectionInfo, String databaseName, String tableName) {
        validateIdentifier(databaseName);
        validateIdentifier(tableName);
        String resolvedDatabase = resolveDatabaseName(connectionInfo, databaseName);
        List<ColumnMetadata> columns = new ArrayList<>();
        String sql = "DESCRIBE " + quoteIdentifier(resolvedDatabase) + "." + quoteIdentifier(tableName);

        try (Connection connection = getConnection(connectionInfo);
             Statement statement = connection.createStatement();
             ResultSet resultSet = statement.executeQuery(sql)) {
            while (resultSet.next()) {
                String columnName = trimToNull(resultSet.getString(1));
                if (columnName == null || columnName.startsWith("#")) {
                    break;
                }

                String columnType = trimToNull(resultSet.getString(2));
                String remarks = trimToNull(resultSet.getString(3));
                columns.add(new ColumnMetadata(columnName, columnType == null ? "" : columnType, 0, true, remarks == null ? "" : remarks, false));
            }
        } catch (Exception e) {
            throw new DataSourceException("获取 Hive 字段列表失败: " + resolvedDatabase + "." + tableName, e);
        }

        return columns;
    }

    @Override
    public TableDetail getTableDetail(DataSourceConnectionInfo connectionInfo, String databaseName, String tableName) {
        validateIdentifier(databaseName);
        validateIdentifier(tableName);
        String resolvedDatabase = resolveDatabaseName(connectionInfo, databaseName);
        String sql = "DESCRIBE FORMATTED " + quoteIdentifier(resolvedDatabase) + "." + quoteIdentifier(tableName);
        List<List<String>> rows = new ArrayList<>();

        try (Connection connection = getConnection(connectionInfo);
             Statement statement = connection.createStatement();
             ResultSet resultSet = statement.executeQuery(sql)) {
            while (resultSet.next()) {
                rows.add(List.of(
                        valueOrEmpty(resultSet.getString(1)),
                        valueOrEmpty(resultSet.getString(2)),
                        valueOrEmpty(resultSet.getString(3))));
            }
        } catch (Exception e) {
            throw new DataSourceException("获取 Hive 表元数据失败: " + resolvedDatabase + "." + tableName, e);
        }

        return parseTableDetail(rows);
    }

    static TableDetail parseTableDetail(List<List<String>> rows) {
        List<ColumnMetadata> columns = new ArrayList<>();
        List<PartitionColumnMetadata> partitionColumns = new ArrayList<>();
        boolean inPartitionSection = false;
        boolean partitioned = false;

        for (List<String> row : rows) {
            String name = trimToNull(rowValue(row, 0));
            if (name == null) {
                continue;
            }
            if ("# Partition Information".equalsIgnoreCase(name)) {
                inPartitionSection = true;
                partitioned = true;
                continue;
            }
            if (name.startsWith("#")) {
                if (name.toLowerCase(Locale.ROOT).contains("detailed table information")) {
                    break;
                }
                continue;
            }

            String type = valueOrEmpty(trimToNull(rowValue(row, 1)));
            String remarks = valueOrEmpty(trimToNull(rowValue(row, 2)));
            if (inPartitionSection) {
                partitionColumns.add(new PartitionColumnMetadata(name, type, remarks));
            } else {
                columns.add(new ColumnMetadata(name, type, 0, true, remarks, false));
            }
        }

        return new TableDetail(columns, partitionColumns, partitioned);
    }

    private String resolveDatabaseName(DataSourceConnectionInfo connectionInfo, String databaseName) {
        return defaultDatabase(
                databaseName == null || databaseName.isBlank() ? connectionInfo.databaseName() : databaseName,
                "default"
        );
    }

    private String quoteIdentifier(String identifier) {
        return "`" + identifier.replace("`", "``") + "`";
    }

    private static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static String rowValue(List<String> row, int index) {
        return row.size() > index ? row.get(index) : null;
    }

    private static String valueOrEmpty(String value) {
        return value == null ? "" : value;
    }
}
