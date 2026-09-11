package io.wbdata.kestra.jdbc;

import com.wbdata.sql.SqlParameterTemplate;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.Map;

public final class SqlAwarePreparedStatement {

    private SqlAwarePreparedStatement() {
    }

    public static PreparedStatement prepare(Connection connection,
                                            String sql,
                                            Map<String, Object> parameters,
                                            StatementFactory statementFactory) throws SQLException {
        SqlParameterTemplate.Compilation compilation = SqlParameterTemplate.compile(sql);
        PreparedStatement statement = statementFactory.create(connection, compilation.jdbcSql());
        for (int index = 0; index < compilation.parameterNames().size(); index++) {
            String name = compilation.parameterNames().get(index);
            if (!parameters.containsKey(name)) {
                throw new IllegalArgumentException("SQL 引用了未提供的参数: " + name);
            }
            statement.setObject(index + 1, parameters.get(name));
        }
        return statement;
    }

    @FunctionalInterface
    public interface StatementFactory {
        PreparedStatement create(Connection connection, String sql) throws SQLException;
    }
}
