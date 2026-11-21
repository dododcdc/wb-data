package com.wbdata.plugin.clickhouse;

import com.wbdata.plugin.api.DataSourceConnectionInfo;
import com.wbdata.plugin.api.DataSourceException;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ClickHouseDataSourcePluginTest {

    @Test
    void buildJdbcUrlUsesHttpInterfaceAndDefaultDatabase() {
        ClickHouseDataSourcePlugin plugin = new ClickHouseDataSourcePlugin();

        String jdbcUrl = plugin.buildJdbcUrl(new DataSourceConnectionInfo(
                1L,
                "CLICKHOUSE",
                "localhost",
                8123,
                "default",
                "wbdata",
                "wbdata123",
                Map.of()
        ));

        assertThat(jdbcUrl).isEqualTo("jdbc:clickhouse://localhost:8123/default");
    }

    @Test
    void buildJdbcUrlUsesAllowedCustomJdbcParamsWhenProvided() {
        ClickHouseDataSourcePlugin plugin = new ClickHouseDataSourcePlugin();

        String jdbcUrl = plugin.buildJdbcUrl(new DataSourceConnectionInfo(
                1L,
                "CLICKHOUSE",
                "localhost",
                8123,
                "analytics",
                "wbdata",
                "wbdata123",
                Map.of("jdbcParams", "ssl=false")
        ));

        assertThat(jdbcUrl).isEqualTo("jdbc:clickhouse://localhost:8123/analytics?ssl=false");
    }

    @Test
    void rejectsDisallowedJdbcParamsAndInjectedDatabase() {
        ClickHouseDataSourcePlugin plugin = new ClickHouseDataSourcePlugin();

        assertThatThrownBy(() -> plugin.validateConnectionInfo(new DataSourceConnectionInfo(
                1L, "CLICKHOUSE", "localhost", 8123, "analytics", "wbdata", "wbdata123",
                Map.of("jdbcParams", "custom_http_params=evil"))))
                .isInstanceOf(DataSourceException.class);

        assertThatThrownBy(() -> plugin.validateConnectionInfo(new DataSourceConnectionInfo(
                1L, "CLICKHOUSE", "localhost", 8123, "default?ssl=false", "wbdata", "wbdata123", Map.of())))
                .isInstanceOf(DataSourceException.class);
    }
}
