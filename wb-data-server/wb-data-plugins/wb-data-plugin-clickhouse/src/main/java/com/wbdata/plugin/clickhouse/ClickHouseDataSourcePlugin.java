package com.wbdata.plugin.clickhouse;

import com.wbdata.plugin.api.AbstractJdbcDataSourcePlugin;
import com.wbdata.plugin.api.DataSourceConnectionInfo;
import com.wbdata.plugin.api.DataSourcePluginDescriptor;
import com.wbdata.plugin.api.PluginFieldDescriptor;

import java.util.List;
import java.util.Set;

public final class ClickHouseDataSourcePlugin extends AbstractJdbcDataSourcePlugin {

    private static final Set<String> ALLOWED_JDBC_PARAMS = Set.of(
            "ssl",
            "sslmode",
            "connect_timeout",
            "socket_timeout",
            "compress",
            "decompress",
            "client_name",
            "use_server_time_zone",
            "use_time_zone",
            "max_execution_time",
            "max_result_rows"
    );

    private static final DataSourcePluginDescriptor DESCRIPTOR = new DataSourcePluginDescriptor(
            "CLICKHOUSE",
            "ClickHouse",
            30,
            "通过 ClickHouse HTTP 接口接入，默认端口 8123。",
            true,
            List.of(
                    new PluginFieldDescriptor("host", "connection", "主机名 / IP 地址", "127.0.0.1", "text", true, null),
                    new PluginFieldDescriptor("port", "connection", "端口", "8123", "text", true, "8123"),
                    new PluginFieldDescriptor("databaseName", "connection", "默认数据库", "如：default", "text", true, null),
                    new PluginFieldDescriptor("username", "authentication", "用户名", "default", "text", true, null),
                    new PluginFieldDescriptor("password", "authentication", "密码", "请输入数据库密码", "password", false, null)
            )
    );

    @Override
    public DataSourcePluginDescriptor descriptor() {
        return DESCRIPTOR;
    }

    @Override
    protected String driverClassName() {
        return "com.clickhouse.jdbc.ClickHouseDriver";
    }

    @Override
    protected String buildJdbcUrl(DataSourceConnectionInfo connectionInfo) {
        String jdbcParams = validateAndNormalizeJdbcParams(
                connectionParam(connectionInfo.connectionParams(), "jdbcParams"),
                ALLOWED_JDBC_PARAMS
        );
        String suffix = jdbcParams == null ? "" : "?" + jdbcParams;
        return String.format(
                "jdbc:clickhouse://%s:%s/%s%s",
                validateHost(connectionInfo.host()),
                validatePort(connectionInfo.port(), "8123"),
                validateDatabaseName(connectionInfo.databaseName(), "default"),
                suffix
        );
    }
}
