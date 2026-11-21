package com.wbdata.plugin.postgresql;

import com.wbdata.plugin.api.AbstractJdbcDataSourcePlugin;
import com.wbdata.plugin.api.DataSourceConnectionInfo;
import com.wbdata.plugin.api.DataSourcePluginDescriptor;
import com.wbdata.plugin.api.PluginFieldDescriptor;

import java.util.List;
import java.util.Set;

public final class PostgreSqlDataSourcePlugin extends AbstractJdbcDataSourcePlugin {

    private static final Set<String> ALLOWED_JDBC_PARAMS = Set.of(
            "ssl",
            "sslmode",
            "currentschema",
            "connecttimeout",
            "sockettimeout",
            "logintimeout",
            "tcpkeepalive",
            "applicationname",
            "preparethreshold",
            "rewritebatchedinserts",
            "stringtype"
    );

    private static final DataSourcePluginDescriptor DESCRIPTOR = new DataSourcePluginDescriptor(
            "POSTGRESQL",
            "PostgreSQL",
            40,
            "适合事务型 PostgreSQL 实例，默认端口 5432。",
            true,
            List.of(
                    new PluginFieldDescriptor("host", "connection", "主机名 / IP 地址", "127.0.0.1", "text", true, null),
                    new PluginFieldDescriptor("port", "connection", "端口", "5432", "text", true, "5432"),
                    new PluginFieldDescriptor("databaseName", "connection", "默认数据库", "如：postgres", "text", true, null),
                    new PluginFieldDescriptor("username", "authentication", "用户名", "postgres", "text", true, null),
                    new PluginFieldDescriptor("password", "authentication", "密码", "请输入数据库密码", "password", false, null)
            )
    );

    @Override
    public DataSourcePluginDescriptor descriptor() {
        return DESCRIPTOR;
    }

    @Override
    protected String driverClassName() {
        return "org.postgresql.Driver";
    }

    @Override
    protected String buildJdbcUrl(DataSourceConnectionInfo connectionInfo) {
        String jdbcParams = validateAndNormalizeJdbcParams(
                connectionParam(connectionInfo.connectionParams(), "jdbcParams"),
                ALLOWED_JDBC_PARAMS
        );
        String suffix = jdbcParams == null ? "" : "?" + jdbcParams;
        return String.format(
                "jdbc:postgresql://%s:%s/%s%s",
                validateHost(connectionInfo.host()),
                validatePort(connectionInfo.port(), "5432"),
                validateDatabaseName(connectionInfo.databaseName(), "postgres"),
                suffix
        );
    }
}
