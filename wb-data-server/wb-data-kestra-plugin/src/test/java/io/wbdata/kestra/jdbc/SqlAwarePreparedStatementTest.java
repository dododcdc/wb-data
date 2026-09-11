package io.wbdata.kestra.jdbc;

import org.junit.jupiter.api.Test;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class SqlAwarePreparedStatementTest {

    @Test
    void bindsOnlyRealParametersAndLeavesColonTextUntouched() throws Exception {
        Connection connection = mock(Connection.class);
        PreparedStatement statement = mock(PreparedStatement.class);

        PreparedStatement result = SqlAwarePreparedStatement.prepare(
                connection,
                "select 'a:tom,b:jack' where day = ${v_day} or previous_day = ${v_day}",
                Map.of("v_day", "20260825"),
                (ignored, sql) -> {
                    assertThat(sql).isEqualTo("select 'a:tom,b:jack' where day = ? or previous_day = ?");
                    return statement;
                }
        );

        assertThat(result).isSameAs(statement);
        verify(statement).setObject(1, "20260825");
        verify(statement).setObject(2, "20260825");
    }

    @Test
    void rejectsMissingBindingsInsteadOfBindingImplicitNull() {
        assertThatThrownBy(() -> SqlAwarePreparedStatement.prepare(
                mock(Connection.class),
                "select ${missing}",
                Map.of(),
                (ignored, sql) -> mock(PreparedStatement.class)
        )).isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("missing");
    }
}
