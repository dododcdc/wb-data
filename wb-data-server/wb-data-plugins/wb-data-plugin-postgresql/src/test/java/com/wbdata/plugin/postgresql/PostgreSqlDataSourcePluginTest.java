package com.wbdata.plugin.postgresql;

import com.wbdata.plugin.api.AbstractJdbcDataSourcePlugin;
import com.wbdata.plugin.api.ColumnMetadata;
import com.wbdata.plugin.api.DataSourceConnectionInfo;
import com.wbdata.plugin.api.DataSourceException;
import com.wbdata.plugin.api.PageResult;
import com.wbdata.plugin.api.TableSummary;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PostgreSqlDataSourcePluginTest {

    @AfterEach
    void resetSupplier() {
        AbstractJdbcDataSourcePlugin.setConnectionSupplier(null);
    }

    @Test
    void buildJdbcUrlUsesDefaultAndAllowedParams() {
        PostgreSqlDataSourcePlugin plugin = new PostgreSqlDataSourcePlugin();

        assertThat(plugin.buildJdbcUrl(new DataSourceConnectionInfo(
                1L, "POSTGRESQL", "pg.internal", null, "", "postgres", "pw", Map.of())))
                .isEqualTo("jdbc:postgresql://pg.internal:5432/postgres");

        assertThat(plugin.buildJdbcUrl(new DataSourceConnectionInfo(
                1L, "POSTGRESQL", "pg.internal", 5433, "warehouse", "postgres", "pw",
                Map.of("jdbcParams", "sslmode=verify-ca&currentSchema=dwd"))))
                .isEqualTo("jdbc:postgresql://pg.internal:5433/warehouse?sslmode=verify-ca&currentSchema=dwd");
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "socketFactory=org.springframework.context.support.ClassPathXmlApplicationContext",
            "socketFactoryArg=http://evil.example/a.xml",
            "loggerFile=/tmp/pwned",
            "options=-c%20foo=bar"
    })
    void rejectsDangerousPostgreSqlJdbcParams(String jdbcParams) {
        PostgreSqlDataSourcePlugin plugin = new PostgreSqlDataSourcePlugin();
        DataSourceConnectionInfo info = new DataSourceConnectionInfo(
                1L, "POSTGRESQL", "localhost", 5432, "postgres", "postgres", "pw", Map.of("jdbcParams", jdbcParams));

        assertThatThrownBy(() -> plugin.validateConnectionInfo(info))
                .isInstanceOf(DataSourceException.class);
    }

    @Test
    void rejectsInjectedHostOrPort() {
        PostgreSqlDataSourcePlugin plugin = new PostgreSqlDataSourcePlugin();

        assertThatThrownBy(() -> plugin.validateConnectionInfo(new DataSourceConnectionInfo(
                1L, "POSTGRESQL", "localhost/postgres?loggerFile=/tmp/x#", 5432, "postgres", "postgres", "pw", Map.of())))
                .isInstanceOf(DataSourceException.class);

        assertThatThrownBy(() -> plugin.validateConnectionInfo(new DataSourceConnectionInfo(
                1L, "POSTGRESQL", "localhost", 70000, "postgres", "postgres", "pw", Map.of())))
                .isInstanceOf(DataSourceException.class);
    }

    @Test
    void getDatabasesQueriesPgDatabaseAndPrioritizesConfiguredDatabase() {
        PostgreSqlDataSourcePlugin plugin = new PostgreSqlDataSourcePlugin();
        List<String> executedSql = new ArrayList<>();
        AbstractJdbcDataSourcePlugin.setConnectionSupplier((info, jdbcUrl, driver, loader) ->
                proxy(Connection.class, (p, m, a) -> switch (m.getName()) {
                    case "createStatement" -> proxy(Statement.class, (sp, sm, sa) -> switch (sm.getName()) {
                        case "executeQuery" -> {
                            executedSql.add((String) sa[0]);
                            yield resultSet(List.of(
                                    Map.of("col1", "analytics"),
                                    Map.of("col1", "dw"),
                                    Map.of("col1", "postgres")));
                        }
                        case "close" -> null;
                        default -> null;
                    });
                    case "close" -> null;
                    default -> null;
                }));

        List<String> databases = plugin.getDatabases(new DataSourceConnectionInfo(
                1L, "POSTGRESQL", "pg.internal", 5432, "dw", "postgres", "pw", Map.of()));

        assertThat(executedSql).singleElement().asString().contains("FROM pg_database WHERE datistemplate = false");
        assertThat(databases).containsExactly("dw", "analytics", "postgres");
    }

    @Test
    void getTablesConnectsToTargetDatabaseExcludesSystemSchemasAndQualifiesNonDefaultSchemas() {
        PostgreSqlDataSourcePlugin plugin = new PostgreSqlDataSourcePlugin();
        AtomicReference<String> capturedUrl = new AtomicReference<>();
        AtomicReference<String> capturedCatalog = new AtomicReference<>();
        AbstractJdbcDataSourcePlugin.setConnectionSupplier((info, jdbcUrl, driver, loader) -> {
            capturedUrl.set(jdbcUrl);
            DatabaseMetaData meta = proxy(DatabaseMetaData.class, (mp, mm, ma) -> switch (mm.getName()) {
                case "getTables" -> {
                    capturedCatalog.set((String) ma[0]);
                    yield resultSet(List.of(
                            Map.of("TABLE_SCHEM", "pg_catalog", "TABLE_NAME", "pg_class", "TABLE_TYPE", "SYSTEM TABLE", "REMARKS", ""),
                            Map.of("TABLE_SCHEM", "information_schema", "TABLE_NAME", "tables", "TABLE_TYPE", "VIEW", "REMARKS", ""),
                            Map.of("TABLE_SCHEM", "pg_toast", "TABLE_NAME", "pg_toast_1", "TABLE_TYPE", "TABLE", "REMARKS", ""),
                            Map.of("TABLE_SCHEM", "pg_temp_1", "TABLE_NAME", "tmp_x", "TABLE_TYPE", "TABLE", "REMARKS", ""),
                            Map.of("TABLE_SCHEM", "public", "TABLE_NAME", "users", "TABLE_TYPE", "TABLE", "REMARKS", "Users"),
                            Map.of("TABLE_SCHEM", "dwd", "TABLE_NAME", "orders", "TABLE_TYPE", "TABLE", "REMARKS", "Orders"),
                            Map.of("TABLE_SCHEM", "dwd", "TABLE_NAME", "order_items", "TABLE_TYPE", "VIEW", "REMARKS", "")
                    ));
                }
                default -> null;
            });
            return proxy(Connection.class, (p, m, a) -> switch (m.getName()) {
                case "getMetaData" -> meta;
                case "close" -> null;
                default -> null;
            });
        });

        DataSourceConnectionInfo info = new DataSourceConnectionInfo(
                1L, "POSTGRESQL", "pg.internal", 5432, "postgres", "postgres", "pw", Map.of());

        PageResult<TableSummary> all = plugin.getTables(info, "analytics", null, 1, 20);
        assertThat(capturedUrl.get()).isEqualTo("jdbc:postgresql://pg.internal:5432/analytics");
        assertThat(capturedCatalog.get()).isEqualTo("analytics");
        assertThat(all.data()).extracting(TableSummary::name)
                .containsExactly("users", "dwd.orders", "dwd.order_items");

        PageResult<TableSummary> filtered = plugin.getTables(info, "analytics", "dwd.order", 1, 20);
        assertThat(filtered.data()).extracting(TableSummary::name)
                .containsExactly("dwd.orders", "dwd.order_items");
    }

    @Test
    void getColumnsSupportsQualifiedSchemaTablesAndUnqualifiedTables() {
        PostgreSqlDataSourcePlugin plugin = new PostgreSqlDataSourcePlugin();
        List<String> pkCalls = new ArrayList<>();
        List<String> colCalls = new ArrayList<>();
        AbstractJdbcDataSourcePlugin.setConnectionSupplier((info, jdbcUrl, driver, loader) -> {
            DatabaseMetaData meta = proxy(DatabaseMetaData.class, (mp, mm, ma) -> switch (mm.getName()) {
                case "getPrimaryKeys" -> {
                    String schema = (String) ma[1];
                    String table = (String) ma[2];
                    pkCalls.add(ma[0] + "|" + schema + "|" + table);
                    if ("public".equals(schema) && "users".equals(table)) {
                        yield resultSet(List.of(Map.of("TABLE_SCHEM", "public", "COLUMN_NAME", "id")));
                    }
                    if ("dwd".equals(schema) && "orders".equals(table)) {
                        yield resultSet(List.of(Map.of("TABLE_SCHEM", "dwd", "COLUMN_NAME", "order_id")));
                    }
                    yield resultSet(List.of());
                }
                case "getColumns" -> {
                    String schema = (String) ma[1];
                    String table = (String) ma[2];
                    colCalls.add(ma[0] + "|" + schema + "|" + table);
                    if ("public".equals(schema) && "users".equals(table)) {
                        yield resultSet(List.of(
                                Map.of("TABLE_SCHEM", "public", "COLUMN_NAME", "id", "TYPE_NAME", "int8", "COLUMN_SIZE", 19, "NULLABLE", DatabaseMetaData.columnNoNulls, "REMARKS", "PK"),
                                Map.of("TABLE_SCHEM", "public", "COLUMN_NAME", "email", "TYPE_NAME", "varchar", "COLUMN_SIZE", 128, "NULLABLE", DatabaseMetaData.columnNullable, "REMARKS", "")
                        ));
                    }
                    if ("dwd".equals(schema) && "orders".equals(table)) {
                        yield resultSet(List.of(
                                Map.of("TABLE_SCHEM", "dwd", "COLUMN_NAME", "order_id", "TYPE_NAME", "int8", "COLUMN_SIZE", 19, "NULLABLE", DatabaseMetaData.columnNoNulls, "REMARKS", "")
                        ));
                    }
                    yield resultSet(List.of());
                }
                default -> null;
            });
            return proxy(Connection.class, (p, m, a) -> switch (m.getName()) {
                case "getMetaData" -> meta;
                case "close" -> null;
                default -> null;
            });
        });

        DataSourceConnectionInfo info = new DataSourceConnectionInfo(
                1L, "POSTGRESQL", "pg.internal", 5432, "postgres", "postgres", "pw", Map.of());

        List<ColumnMetadata> publicCols = plugin.getColumns(info, "analytics", "users");
        assertThat(publicCols).hasSize(2);
        assertThat(publicCols.get(0).name()).isEqualTo("id");
        assertThat(publicCols.get(0).primaryKey()).isTrue();
        assertThat(publicCols.get(1).primaryKey()).isFalse();

        List<ColumnMetadata> qualifiedCols = plugin.getColumns(info, "analytics", "dwd.orders");
        assertThat(qualifiedCols).singleElement().satisfies(col -> {
            assertThat(col.name()).isEqualTo("order_id");
            assertThat(col.primaryKey()).isTrue();
        });
        assertThat(pkCalls).containsExactly("analytics|public|users", "analytics|dwd|orders");
        assertThat(colCalls).containsExactly("analytics|public|users", "analytics|dwd|orders");
    }

    private static ResultSet resultSet(List<Map<String, Object>> rows) {
        final int[] cursor = {-1};
        return proxy(ResultSet.class, (proxy, method, args) -> switch (method.getName()) {
            case "next" -> {
                cursor[0]++;
                yield cursor[0] < rows.size();
            }
            case "getString" -> {
                Object key = args[0];
                Object val = key instanceof Integer idx
                        ? new ArrayList<>(rows.get(cursor[0]).values()).get(idx - 1)
                        : rows.get(cursor[0]).get(key);
                yield val == null ? null : String.valueOf(val);
            }
            case "getInt" -> {
                Object val = rows.get(cursor[0]).get(args[0]);
                yield val instanceof Number num ? num.intValue() : 0;
            }
            case "close" -> null;
            default -> null;
        });
    }

    private static <T> T proxy(Class<T> type, InvocationHandler handler) {
        return type.cast(Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[]{type}, handler));
    }
}
