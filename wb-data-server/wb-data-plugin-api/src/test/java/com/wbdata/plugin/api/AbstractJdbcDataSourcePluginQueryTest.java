package com.wbdata.plugin.api;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.SQLFeatureNotSupportedException;
import java.sql.Statement;
import java.sql.Types;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AbstractJdbcDataSourcePluginQueryTest {

    private QueryStubState stubState;

    private final AbstractJdbcDataSourcePlugin plugin = new AbstractJdbcDataSourcePlugin() {
        @Override
        protected String driverClassName() {
            return "stub.Driver";
        }

        @Override
        protected String buildJdbcUrl(DataSourceConnectionInfo connectionInfo) {
            return "jdbc:stub://" + connectionInfo.host() + "/" + connectionInfo.databaseName();
        }

        @Override
        public DataSourcePluginDescriptor descriptor() {
            return null;
        }
    };

    @BeforeEach
    void setUp() {
        stubState = new QueryStubState();
        AbstractJdbcDataSourcePlugin.setConnectionSupplier((info, jdbcUrl, driver, loader) -> stubState.connectionProxy());
    }

    @AfterEach
    void tearDown() {
        AbstractJdbcDataSourcePlugin.setConnectionSupplier(null);
    }

    @Test
    void setsMaxRowsPlusOneAndReportsTruncatedWhenMoreRowsExist() {
        stubState.columns = List.of(new StubColumn("id", "id", "INT"));
        stubState.rows = List.of(List.of(1), List.of(2), List.of(3));

        QueryResult result = plugin.executeQuery(new QueryRequest(connectionInfo("analytics"), "SELECT id FROM t", 2));

        assertEquals(3, stubState.maxRowsSet);
        assertTrue(result.truncated());
        assertEquals(2, result.rows().size());
        assertEquals(List.of(Map.of("id", 1), Map.of("id", 2)), result.rows());
        assertTrue(result.message().contains("Result truncated"));
    }

    @Test
    void doesNotReportTruncatedWhenRowCountEqualsLimit() {
        stubState.columns = List.of(new StubColumn("id", "id", "INT"));
        stubState.rows = List.of(List.of(1), List.of(2));

        QueryResult result = plugin.executeQuery(new QueryRequest(connectionInfo("analytics"), "SELECT id FROM t", 2));

        assertEquals(3, stubState.maxRowsSet);
        assertFalse(result.truncated());
        assertEquals(2, result.rows().size());
        assertEquals("Success", result.message());
    }

    @Test
    void prefersColumnLabelAndDeduplicatesRepeatedColumnNames() {
        stubState.columns = List.of(
                new StubColumn("id", "user_id", "BIGINT"),
                new StubColumn("id", "id", "BIGINT"),
                new StubColumn("id", "id", "BIGINT")
        );
        stubState.rows = List.of(List.of(10L, 20L, 30L));

        QueryResult result = plugin.executeQuery(new QueryRequest(connectionInfo("analytics"), "SELECT 1", 10));

        assertEquals(List.of("user_id", "id", "id_2"),
                result.columns().stream().map(ColumnMetadata::name).toList());
        assertEquals(Map.of("user_id", 10L, "id", 20L, "id_2", 30L), result.rows().getFirst());
    }

    @Test
    void appliesDefaultAndCustomQueryTimeoutAndIgnoresUnsupportedDrivers() {
        stubState.columns = List.of(new StubColumn("ok", "ok", "INT"));
        stubState.rows = List.of(List.of(1));

        plugin.executeQuery(new QueryRequest(connectionInfo("analytics"), "SELECT 1", 10));
        assertEquals(AbstractJdbcDataSourcePlugin.DEFAULT_QUERY_TIMEOUT_SECONDS, stubState.timeoutSet);

        plugin.executeQuery(new QueryRequest(connectionInfo("analytics"), "SELECT 1", 10, 25));
        assertEquals(25, stubState.timeoutSet);

        stubState.throwUnsupportedOnSetQueryTimeout = true;
        QueryResult result = plugin.executeQuery(new QueryRequest(connectionInfo("analytics"), "SELECT 1", 10, 15));
        assertEquals(1, result.rows().size());
    }

    @Test
    void restoresPreviousCatalogOnPooledConnectionAfterQuery() {
        stubState.initialCatalog = "default_db";
        stubState.columns = List.of(new StubColumn("ok", "ok", "INT"));
        stubState.rows = List.of(List.of(1));

        plugin.executeQuery(new QueryRequest(connectionInfo("target_db"), "SELECT 1", 10));

        assertEquals(List.of("target_db", "default_db"), stubState.catalogHistory);
        assertEquals("default_db", stubState.currentCatalog);
    }

    @Test
    void streamQueryEmitsRowsIncrementallyHonorsLimitWithNullValuesAndRestoresCatalog() {
        stubState.initialCatalog = "default_db";
        stubState.columns = List.of(
                new StubColumn("id", "user_id", "BIGINT"),
                new StubColumn("id", "id", "BIGINT"),
                new StubColumn("id", "id", "BIGINT")
        );
        stubState.rows = List.of(
                Arrays.asList(10L, null, 30L),
                Arrays.asList(40L, 50L, 60L),
                Arrays.asList(70L, 80L, 90L)
        );

        List<String> capturedColumns = new ArrayList<>();
        List<List<Object>> streamedRows = new ArrayList<>();
        QueryStreamSummary summary = plugin.streamQuery(
                new QueryRequest(connectionInfo("target_db"), "SELECT id FROM t", 2, 30),
                new QueryRowHandler() {
                    @Override
                    public void onColumns(List<ColumnMetadata> columns) {
                        columns.forEach(c -> capturedColumns.add(c.name()));
                    }

                    @Override
                    public void onRow(List<Object> values) {
                        streamedRows.add(values);
                    }
                });

        assertEquals(3, stubState.maxRowsSet);
        assertEquals(30, stubState.timeoutSet);
        assertEquals(List.of("user_id", "id", "id_2"), capturedColumns);
        assertEquals(2, streamedRows.size());
        assertEquals(Arrays.asList(10L, null, 30L), streamedRows.get(0));
        assertEquals(Arrays.asList(40L, 50L, 60L), streamedRows.get(1));
        assertEquals(2, summary.rowCount());
        assertTrue(summary.truncated());
        assertEquals(List.of("target_db", "default_db"), stubState.catalogHistory);
        assertEquals("default_db", stubState.currentCatalog);
    }

    private DataSourceConnectionInfo connectionInfo(String databaseName) {
        return new DataSourceConnectionInfo(1L, "MYSQL", "localhost", 3306, databaseName, "root", "pw", Map.of());
    }

    private record StubColumn(String columnName, String columnLabel, String typeName) {
    }

    private static class QueryStubState {
        String initialCatalog = "analytics";
        String currentCatalog = "analytics";
        final List<String> catalogHistory = new ArrayList<>();
        int maxRowsSet = -1;
        int timeoutSet = -1;
        boolean throwUnsupportedOnSetQueryTimeout;
        List<StubColumn> columns = List.of();
        List<List<Object>> rows = List.of();

        Connection connectionProxy() {
            currentCatalog = initialCatalog;
            return proxy(Connection.class, (proxy, method, args) -> switch (method.getName()) {
                case "getCatalog" -> currentCatalog;
                case "setCatalog" -> {
                    currentCatalog = (String) args[0];
                    catalogHistory.add(currentCatalog);
                    yield null;
                }
                case "createStatement" -> statementProxy();
                case "close" -> null;
                default -> null;
            });
        }

        private Statement statementProxy() {
            return proxy(Statement.class, (proxy, method, args) -> switch (method.getName()) {
                case "setQueryTimeout" -> {
                    if (throwUnsupportedOnSetQueryTimeout) {
                        throw new SQLFeatureNotSupportedException("setQueryTimeout not supported");
                    }
                    timeoutSet = (int) args[0];
                    yield null;
                }
                case "setMaxRows" -> {
                    maxRowsSet = (int) args[0];
                    yield null;
                }
                case "execute" -> true;
                case "getResultSet" -> resultSetProxy();
                case "close" -> null;
                default -> null;
            });
        }

        private ResultSet resultSetProxy() {
            final int[] cursor = {-1};
            int cappedSize = maxRowsSet > 0 ? Math.min(rows.size(), maxRowsSet) : rows.size();
            return proxy(ResultSet.class, (proxy, method, args) -> switch (method.getName()) {
                case "getMetaData" -> metaDataProxy();
                case "next" -> {
                    cursor[0]++;
                    yield cursor[0] < cappedSize;
                }
                case "getObject" -> rows.get(cursor[0]).get(((int) args[0]) - 1);
                case "close" -> null;
                default -> null;
            });
        }

        private ResultSetMetaData metaDataProxy() {
            return proxy(ResultSetMetaData.class, (proxy, method, args) -> switch (method.getName()) {
                case "getColumnCount" -> columns.size();
                case "getColumnName" -> columns.get(((int) args[0]) - 1).columnName();
                case "getColumnLabel" -> columns.get(((int) args[0]) - 1).columnLabel();
                case "getColumnTypeName" -> columns.get(((int) args[0]) - 1).typeName();
                case "getPrecision" -> 10;
                case "isNullable" -> ResultSetMetaData.columnNullable;
                case "getColumnType" -> Types.VARCHAR;
                default -> null;
            });
        }
    }

    private static <T> T proxy(Class<T> type, InvocationHandler handler) {
        return type.cast(Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[]{type}, handler));
    }
}
