package com.wbdata.plugin.api;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.Driver;
import java.sql.DriverPropertyInfo;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.logging.Logger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AbstractJdbcDataSourcePluginStatementsTest {

    private static final List<String> SQL = List.of(
            "CREATE TABLE target (id INT)",
            "INSERT INTO target VALUES (1)",
            "UPDATE target SET id = 2",
            "DELETE FROM target WHERE id = 3",
            "SELECT * FROM target");
    private static final ThreadLocal<DriverState> DRIVER_STATE = new ThreadLocal<>();

    private final AbstractJdbcDataSourcePlugin plugin = new AbstractJdbcDataSourcePlugin() {
        @Override
        protected String driverClassName() {
            return TestDriver.class.getName();
        }

        @Override
        protected String buildJdbcUrl(DataSourceConnectionInfo info) {
            return "jdbc:statement-test:" + info.type() + "/" + info.databaseName();
        }

        @Override
        public DataSourcePluginDescriptor descriptor() {
            return null;
        }
    };
    private DriverState state;

    @BeforeEach
    void setUp() {
        state = new DriverState();
        DRIVER_STATE.set(state);
        AbstractJdbcDataSourcePlugin.setConnectionSupplier((info, url, driver, loader) -> {
            throw new AssertionError("executeStatements must not use the cached connection pool");
        });
    }

    @AfterEach
    void tearDown() {
        AbstractJdbcDataSourcePlugin.setConnectionSupplier(null);
        DRIVER_STATE.remove();
    }

    @Test
    void emptyListDoesNotConnect() {
        plugin.executeStatements(info("MYSQL", "target"), List.of(), Map.of(), 30);

        assertTrue(state.urls.isEmpty());
        assertTrue(state.sessions.isEmpty());
    }

    @ParameterizedTest
    @ValueSource(strings = {"MYSQL", "POSTGRESQL", "CLICKHOUSE", "HIVE"})
    void executesFiveStatementsInOrderOnOneDirectAutocommitConnection(String type) {
        plugin.executeStatements(info(type, "target"), SQL, Map.of(), 37);

        assertEquals(List.of("jdbc:statement-test:" + type + "/target"), state.urls);
        assertEquals(1, state.sessions.size());
        Session session = state.sessions.getFirst();
        assertEquals(SQL, session.executed);
        assertSessionClosed(session, 5);
        List<String> expectedEvents = new ArrayList<>(List.of("autoCommit:true"));
        for (String sql : SQL) {
            expectedEvents.addAll(List.of("prepareStatement:" + sql, "timeout:37", "execute:" + sql, "closeStatement"));
        }
        expectedEvents.add("closeConnection");
        assertEquals(expectedEvents, session.events);
        // JDBC proxies reject commit/rollback, result-set reads and every other unexpected call.
    }

    @ParameterizedTest
    @ValueSource(ints = {1, 3, 5})
    void stopsOnFirstFailureWithoutRetryCommitOrRollback(int failedIndex) {
        state.failedSql = SQL.get(failedIndex - 1);

        SqlExecutionException error = assertThrows(SqlExecutionException.class,
                () -> plugin.executeStatements(info("MYSQL", "target"), SQL, Map.of(), 30));

        assertEquals(failedIndex, error.getStatementIndex());
        assertEquals("SQL 语句执行失败", error.getMessage());
        assertSame(state.failure, error.getCause());
        assertEquals(1, state.urls.size());
        Session session = state.sessions.getFirst();
        assertEquals(SQL.subList(0, failedIndex), session.executed);
        assertSessionClosed(session, failedIndex);
    }

    @Test
    void connectionFailureHasIndexZeroAndSafeMessage() {
        state.failureMethod = "connect";

        SqlExecutionException error = assertThrows(SqlExecutionException.class,
                () -> plugin.executeStatements(info("POSTGRESQL", "target"), SQL, Map.of(), 30));

        assertEquals(0, error.getStatementIndex());
        assertEquals("SQL 执行连接失败", error.getMessage());
        assertSame(state.failure, error.getCause());
        assertEquals(1, state.urls.size());
        assertTrue(state.sessions.isEmpty());
    }

    @ParameterizedTest
    @ValueSource(strings = {"setAutoCommit", "prepareStatement", "setQueryTimeout"})
    void initializationFailuresCloseResourcesWithoutExecuting(String failureMethod) {
        state.failureMethod = failureMethod;

        SqlExecutionException error = assertThrows(SqlExecutionException.class,
                () -> plugin.executeStatements(info("CLICKHOUSE", "target"), SQL, Map.of(), 30));

        assertEquals(failureMethod.equals("setAutoCommit") ? 0 : 1, error.getStatementIndex());
        assertSame(state.failure, error.getCause());
        Session session = state.sessions.getFirst();
        assertTrue(session.executed.isEmpty());
        assertSessionClosed(session, failureMethod.equals("setQueryTimeout") ? 1 : 0);
    }

    @Test
    void closeFailuresDoNotReplaceTheStatementFailureOrPreventConnectionClose() {
        state.failedSql = SQL.get(1);
        state.failClose = true;

        SqlExecutionException error = assertThrows(SqlExecutionException.class,
                () -> plugin.executeStatements(info("MYSQL", "target"), SQL.subList(1, 5), Map.of(), 30));

        assertEquals(1, error.getStatementIndex());
        assertEquals("SQL 语句执行失败", error.getMessage());
        assertSame(state.failure, error.getCause());
        assertEquals(2, error.getCause().getSuppressed().length);
        assertSessionClosed(state.sessions.getFirst(), 1);
    }

    @ParameterizedTest
    @ValueSource(strings = {"MYSQL", "POSTGRESQL", "CLICKHOUSE"})
    void sameDataSourceIdDoesNotReuseOrPolluteOtherDatabaseConnections(String type) {
        DataSourceConnectionInfo first = info(type, "first_database");
        DataSourceConnectionInfo second = info(type, "second_database");
        assertEquals(first.dataSourceId(), second.dataSourceId());

        plugin.executeStatements(first, List.of("SET session_flag = 1", SQL.getFirst()), Map.of(), 10);
        plugin.executeStatements(second, List.of(SQL.get(1)), Map.of(), 20);
        plugin.executeStatements(first, List.of(SQL.get(2)), Map.of(), 30);

        assertEquals(List.of("jdbc:statement-test:" + type + "/first_database",
                "jdbc:statement-test:" + type + "/second_database",
                "jdbc:statement-test:" + type + "/first_database"), state.urls);
        assertEquals(3, state.sessions.size());
        assertEquals(List.of("SET session_flag = 1", SQL.getFirst()), state.sessions.get(0).executed);
        assertEquals(List.of(SQL.get(1)), state.sessions.get(1).executed);
        assertEquals(List.of(SQL.get(2)), state.sessions.get(2).executed);
        assertSessionClosed(state.sessions.get(0), 2);
        assertSessionClosed(state.sessions.get(1), 1);
        assertSessionClosed(state.sessions.get(2), 1);
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "O'Reilly", "\"quoted\"", "C:\\tmp\\", "中文", "\0\r\n\t",
            "'; DROP TABLE target; --\\", "^[other]?"})
    void bindsAllValuesAsStringsWithoutChangingSql(String value) {
        List<String> templates = List.of(SQL.getFirst(),
                "INSERT INTO target VALUES (^[value], ^[empty], ^[value])",
                "UPDATE target SET name = ^[value]");
        plugin.executeStatements(info("MYSQL", "target"), templates,
                Map.of("value", value, "empty", "", "unused", "ignored"), 19);

        assertEquals(1, state.sessions.size());
        Session session = state.sessions.getFirst();
        assertEquals(List.of(SQL.getFirst(), "INSERT INTO target VALUES (?, ?, ?)",
                "UPDATE target SET name = ?"), session.executed);
        assertTrue(session.statements.get(0).bindings.isEmpty());
        assertEquals(List.of(value, "", value), session.statements.get(1).bindings);
        assertEquals(List.of(value), session.statements.get(2).bindings);
        assertEquals(List.of("autoCommit:true",
                "prepareStatement:" + SQL.getFirst(), "timeout:19", "execute:" + SQL.getFirst(), "closeStatement",
                "prepareStatement:INSERT INTO target VALUES (?, ?, ?)", "timeout:19",
                "setString:1:" + value, "setString:2:", "setString:3:" + value,
                "execute:INSERT INTO target VALUES (?, ?, ?)", "closeStatement",
                "prepareStatement:UPDATE target SET name = ?", "timeout:19", "setString:1:" + value,
                "execute:UPDATE target SET name = ?", "closeStatement", "closeConnection"), session.events);
        assertSessionClosed(session, 3);
    }

    @Test
    void ignoresTemplatesInCommentsAndPreservesLiteralQuestionMarks() {
        String sql = "SELECT '?' FROM target WHERE name = ^[name] /* ^[missing] */ -- ^[bad\n# ^[also_missing]";
        plugin.executeStatements(info("POSTGRESQL", "target"), List.of(sql), Map.of("name", "中文"), 10);

        Session session = state.sessions.getFirst();
        assertEquals(List.of(sql.replace("^[name]", "?")), session.executed);
        assertEquals(List.of("中文"), session.statements.getFirst().bindings);
        assertSessionClosed(session, 1);
    }

    @ParameterizedTest
    @ValueSource(ints = {1, 2, 3})
    void missingParametersAnywherePreventTheEntireStageFromConnecting(int invalidIndex) {
        List<String> statements = new ArrayList<>(List.of(SQL.get(1), SQL.get(2), SQL.get(3)));
        statements.set(invalidIndex - 1, "UPDATE target SET name = ^[missing]");

        SqlExecutionException error = assertThrows(SqlExecutionException.class,
                () -> plugin.executeStatements(info("MYSQL", "target"), statements, Map.of(), 30));

        assertEquals(invalidIndex, error.getStatementIndex());
        assertTrue(error.getCause() instanceof IllegalArgumentException);
        assertTrue(error.getCause().getMessage().contains("missing"));
        assertTrue(state.urls.isEmpty());
        assertTrue(state.sessions.isEmpty());
    }

    @Test
    void nullParameterInLaterStatementPreventsEarlierWrites() {
        Map<String, String> parameters = new HashMap<>();
        parameters.put("present", "private value");
        parameters.put("missing", null);

        SqlExecutionException error = assertThrows(SqlExecutionException.class,
                () -> plugin.executeStatements(info("MYSQL", "target"), List.of(
                        "INSERT INTO target VALUES (^[present])", "UPDATE target SET name = ^[missing]"), parameters, 30));

        assertEquals(2, error.getStatementIndex());
        assertTrue(error.getCause() instanceof IllegalArgumentException);
        assertEquals("SQL 语句执行失败", error.getMessage());
        assertTrue(state.urls.isEmpty());
        assertTrue(state.sessions.isEmpty());
    }

    @Test
    void nullParameterMapIsMissingOnlyWhenParametersAreReferenced() {
        plugin.executeStatements(info("MYSQL", "target"), List.of(SQL.getFirst()), null, 30);
        assertSessionClosed(state.sessions.getFirst(), 1);

        SqlExecutionException error = assertThrows(SqlExecutionException.class,
                () -> plugin.executeStatements(info("MYSQL", "target"), List.of(
                        "UPDATE target SET name = ^[missing]"), null, 30));

        assertEquals(1, error.getStatementIndex());
        assertTrue(error.getCause() instanceof IllegalArgumentException);
        assertEquals(1, state.urls.size());
    }

    @ParameterizedTest
    @ValueSource(strings = {"^[_invalid]", "^[unclosed", "'^[value]'", "\"^[value]\"",
            "`^[value]`", "$$ ^[value] $$", "$tag$ ^[value] $tag$"})
    void invalidTemplatesInLaterStatementsPreventEarlierWrites(String template) {
        SqlExecutionException error = assertThrows(SqlExecutionException.class,
                () -> plugin.executeStatements(info("MYSQL", "target"), List.of(SQL.get(1),
                        "UPDATE target SET name = " + template), Map.of("value", "private value"), 30));

        assertEquals(2, error.getStatementIndex());
        assertTrue(error.getCause() instanceof IllegalArgumentException);
        assertTrue(state.urls.isEmpty());
        assertTrue(state.sessions.isEmpty());
    }

    @Test
    void bindingFailureStopsAtItsStatementAndClosesResources() {
        state.failureMethod = "setString";

        SqlExecutionException error = assertThrows(SqlExecutionException.class,
                () -> plugin.executeStatements(info("MYSQL", "target"), List.of(SQL.getFirst(),
                        "INSERT INTO target VALUES (^[value])", SQL.get(2)), Map.of("value", "private"), 30));

        assertEquals(2, error.getStatementIndex());
        assertSame(state.failure, error.getCause());
        Session session = state.sessions.getFirst();
        assertEquals(List.of(SQL.getFirst()), session.executed);
        assertSessionClosed(session, 2);
    }

    private static DataSourceConnectionInfo info(String type, String database) {
        return new DataSourceConnectionInfo(42L, type, "localhost", 1234, database, "user", "password", null);
    }

    private static void assertSessionClosed(Session session, int statementCount) {
        assertEquals(1, session.closeCount);
        assertEquals(statementCount, session.statements.size());
        for (TestStatement statement : session.statements) {
            assertEquals(1, statement.closeCount);
        }
    }

    private static <T> T proxy(Class<T> type, InvocationHandler handler) {
        return type.cast(Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[]{type}, handler));
    }

    private static class DriverState {
        final List<String> urls = new ArrayList<>();
        final List<Session> sessions = new ArrayList<>();
        final SQLException failure = new SQLException("private SQL / database / password from driver");
        String failedSql;
        String failureMethod;
        boolean failClose;

        void failIf(String method) throws SQLException {
            if (method.equals(failureMethod)) {
                throw failure;
            }
        }
    }

    private static class Session {
        final List<String> executed = new ArrayList<>();
        final List<String> events = new ArrayList<>();
        final List<TestStatement> statements = new ArrayList<>();
        int closeCount;
        boolean autoCommit;

        Connection connection(DriverState state) {
            return proxy(Connection.class, (object, method, args) -> {
                String name = method.getName();
                state.failIf(name);
                switch (name) {
                    case "setAutoCommit" -> {
                        autoCommit = (boolean) args[0];
                        events.add("autoCommit:" + autoCommit);
                    }
                    case "prepareStatement" -> {
                        String sql = (String) args[0];
                        events.add("prepareStatement:" + sql);
                        TestStatement statement = new TestStatement(sql);
                        statements.add(statement);
                        return statement.statement(state, this);
                    }
                    case "close" -> {
                        closeCount++;
                        events.add("closeConnection");
                        if (state.failClose) {
                            throw new SQLException("private connection close error");
                        }
                    }
                    default -> throw new AssertionError("Unexpected connection call: " + name);
                }
                return null;
            });
        }
    }

    private static class TestStatement {
        final String sql;
        final List<String> bindings = new ArrayList<>();
        int closeCount;
        boolean timeoutSet;

        TestStatement(String sql) {
            this.sql = sql;
        }

        PreparedStatement statement(DriverState state, Session session) {
            return proxy(PreparedStatement.class, (object, method, args) -> {
                String name = method.getName();
                state.failIf(name);
                switch (name) {
                    case "setQueryTimeout" -> {
                        timeoutSet = true;
                        session.events.add("timeout:" + args[0]);
                    }
                    case "setString" -> {
                        assertEquals(bindings.size() + 1, args[0]);
                        bindings.add((String) args[1]);
                        session.events.add("setString:" + args[0] + ":" + args[1]);
                    }
                    case "execute" -> {
                        assertTrue(args == null || args.length == 0, "PreparedStatement.execute must not receive SQL");
                        assertTrue(session.autoCommit);
                        assertTrue(timeoutSet);
                        assertEquals(0, session.closeCount);
                        session.executed.add(sql);
                        session.events.add("execute:" + sql);
                        if (sql.equals(state.failedSql)) {
                            throw state.failure;
                        }
                        return true; // Even a returned result set must never be materialized.
                    }
                    case "close" -> {
                        closeCount++;
                        session.events.add("closeStatement");
                        if (state.failClose) {
                            throw new SQLException("private statement close error");
                        }
                    }
                    default -> throw new AssertionError("Unexpected statement call: " + name);
                }
                return null;
            });
        }
    }

    public static class TestDriver implements Driver {
        @Override
        public Connection connect(String url, Properties info) throws SQLException {
            if (!acceptsURL(url)) {
                return null;
            }
            DriverState state = DRIVER_STATE.get();
            state.urls.add(url);
            state.failIf("connect");
            Session session = new Session();
            state.sessions.add(session);
            return session.connection(state);
        }

        @Override
        public boolean acceptsURL(String url) {
            return url.startsWith("jdbc:statement-test:");
        }

        @Override
        public DriverPropertyInfo[] getPropertyInfo(String url, Properties info) {
            return new DriverPropertyInfo[0];
        }

        @Override
        public int getMajorVersion() {
            return 1;
        }

        @Override
        public int getMinorVersion() {
            return 0;
        }

        @Override
        public boolean jdbcCompliant() {
            return false;
        }

        @Override
        public Logger getParentLogger() {
            return Logger.getGlobal();
        }
    }
}
