package com.wbdata.plugin.mysql;

import com.wbdata.plugin.api.DataSourceConnectionInfo;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Method;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class MySqlDataSourcePluginTest {

    @Test
    void buildJdbcUrlAllowsPublicKeyRetrievalByDefault() throws Exception {
        MySqlDataSourcePlugin plugin = new MySqlDataSourcePlugin();

        String jdbcUrl = buildJdbcUrl(plugin, new DataSourceConnectionInfo(
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
    void buildJdbcUrlUsesCustomJdbcParamsWhenProvided() throws Exception {
        MySqlDataSourcePlugin plugin = new MySqlDataSourcePlugin();

        String jdbcUrl = buildJdbcUrl(plugin, new DataSourceConnectionInfo(
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

    private static String buildJdbcUrl(MySqlDataSourcePlugin plugin, DataSourceConnectionInfo connectionInfo)
            throws Exception {
        Method method = MySqlDataSourcePlugin.class.getDeclaredMethod("buildJdbcUrl", DataSourceConnectionInfo.class);
        method.setAccessible(true);
        return (String) method.invoke(plugin, connectionInfo);
    }
}
