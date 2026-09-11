package io.wbdata.kestra.jdbc.mysql;

import io.kestra.core.exceptions.IllegalVariableEvaluationException;
import io.kestra.core.models.annotations.Plugin;
import io.kestra.core.runners.RunContext;
import io.wbdata.kestra.jdbc.SqlAwarePreparedStatement;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.ToString;
import lombok.experimental.SuperBuilder;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.Map;

@SuperBuilder
@ToString(callSuper = true)
@EqualsAndHashCode(callSuper = true)
@Getter
@NoArgsConstructor
@Schema(title = "Execute a SQL-aware parameterized query against MySQL")
@Plugin
public class Query extends io.kestra.plugin.jdbc.mysql.Query {

    @Override
    protected PreparedStatement prepareStatement(RunContext runContext,
                                                 Connection connection,
                                                 String sql) throws SQLException, IllegalVariableEvaluationException {
        Map<String, Object> parameters = runContext.render(getParameters()).asMap(String.class, Object.class);
        return SqlAwarePreparedStatement.prepare(connection, sql, parameters, this::createPreparedStatement);
    }
}
