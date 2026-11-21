package com.wbdata.plugin.mysql;

import com.wbdata.plugin.api.DataSourceConnectionInfo;
import com.wbdata.plugin.api.DataSourceException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class MySqlDataSourcePluginTest {

    @Test
    void buildJdbcUrlAllowsPublicKeyRetrievalByDefault() {
        MySqlDataSourcePlugin plugin = new MySqlDataSourcePlugin();

        String jdbcUrl = plugin.buildJdbcUrl(new DataSourceConnectionInfo(
                1L,
                "MYSQL",
                "localhost",
                13306,
                "transfer_demo",
                "root",
                "root",
                Map.of()
        ));

        assertThat(jdbcUrl)
                .isEqualTo("jdbc:mysql://localhost:13306/transfer_demo?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC");
    }

    @Test
    void buildJdbcUrlUsesAllowedCustomJdbcParamsWhenProvided() {
        MySqlDataSourcePlugin plugin = new MySqlDataSourcePlugin();

        String jdbcUrl = plugin.buildJdbcUrl(new DataSourceConnectionInfo(
                1L,
                "MYSQL",
                "localhost",
                3306,
                "demo",
                "root",
                "root",
                Map.of("jdbcParams", "useSSL=true&serverTimezone=Asia/Shanghai")
        ));

        assertThat(jdbcUrl)
                .isEqualTo("jdbc:mysql://localhost:3306/demo?useSSL=true&serverTimezone=Asia/Shanghai");
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "allowLoadLocalInfile=true",
            "autoDeserialize=true",
            "queryInterceptors=com.evil.Interceptor",
            "useSSL=false&allowLoadLocalInfile=true",
            "?useSSL=false",
            "useSSL=false#evil",
            "useSSL=false;evil=1"
    })
    void rejectsDisallowedOrMalformedJdbcParams(String jdbcParams) {
        MySqlDataSourcePlugin plugin = new MySqlDataSourcePlugin();
        DataSourceConnectionInfo info = new DataSourceConnectionInfo(
                1L, "MYSQL", "localhost", 3306, "demo", "root", "root", Map.of("jdbcParams", jdbcParams));

        assertThatThrownBy(() -> plugin.validateConnectionInfo(info))
                .isInstanceOf(DataSourceException.class);
    }

    @Test
    void rejectsInjectedHostOrDatabaseName() {
        MySqlDataSourcePlugin plugin = new MySqlDataSourcePlugin();

        assertThatThrownBy(() -> plugin.validateConnectionInfo(new DataSourceConnectionInfo(
                1L, "MYSQL", "127.0.0.1:3306/db?autoDeserialize=true#", 3306, "demo", "root", "root", Map.of())))
                .isInstanceOf(DataSourceException.class);

        assertThatThrownBy(() -> plugin.validateConnectionInfo(new DataSourceConnectionInfo(
                1L, "MYSQL", "localhost", 3306, "demo?autoDeserialize=true", "root", "root", Map.of())))
                .isInstanceOf(DataSourceException.class);
    }
}
