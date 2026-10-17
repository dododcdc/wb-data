package com.wbdata.plugin.clickhouse;

import com.wbdata.plugin.api.DataSourceConnectionInfo;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Method;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ClickHouseDataSourcePluginTest {

    @Test
    void buildJdbcUrlUsesHttpInterfaceAndDefaultDatabase() throws Exception {
        ClickHouseDataSourcePlugin plugin = new ClickHouseDataSourcePlugin();

        String jdbcUrl = buildJdbcUrl(plugin, new DataSourceConnectionInfo(
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
    void buildJdbcUrlUsesCustomJdbcParamsWhenProvided() throws Exception {
        ClickHouseDataSourcePlugin plugin = new ClickHouseDataSourcePlugin();

        String jdbcUrl = buildJdbcUrl(plugin, new DataSourceConnectionInfo(
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

    private static String buildJdbcUrl(ClickHouseDataSourcePlugin plugin, DataSourceConnectionInfo connectionInfo)
            throws Exception {
        Method method = ClickHouseDataSourcePlugin.class.getDeclaredMethod("buildJdbcUrl", DataSourceConnectionInfo.class);
        method.setAccessible(true);
        return (String) method.invoke(plugin, connectionInfo);
    }
}
