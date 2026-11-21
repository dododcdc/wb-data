package com.wbdata.plugin.mysql;

import com.wbdata.plugin.api.AbstractJdbcDataSourcePlugin;
import com.wbdata.plugin.api.DataSourceConnectionInfo;
import com.wbdata.plugin.api.DataSourcePluginDescriptor;
import com.wbdata.plugin.api.PluginFieldDescriptor;

import java.util.List;
import java.util.Set;

/**
 * MySQL 数据源插件
 */
public final class MySqlDataSourcePlugin extends AbstractJdbcDataSourcePlugin {

    private static final Set<String> ALLOWED_JDBC_PARAMS = Set.of(
            "usessl",
            "sslmode",
            "allowpublickeyretrieval",
            "servertimezone",
            "characterencoding",
            "useunicode",
            "connecttimeout",
            "sockettimeout",
            "zerodatetimebehavior",
            "tinyint1isbit",
            "useinformationschema",
            "rewritebatchedstatements"
    );

    private static final DataSourcePluginDescriptor DESCRIPTOR = new DataSourcePluginDescriptor(
            "MYSQL",
            "MySQL",
            10,
            "通过 MySQL JDBC 直连，适合 OLTP 数据库和常规业务库接入。",
            true,
            List.of(
                    new PluginFieldDescriptor("host", "connection", "主机名 / IP 地址", "127.0.0.1", "text", true, null),
                    new PluginFieldDescriptor("port", "connection", "端口", "3306", "text", true, "3306"),
                    new PluginFieldDescriptor("databaseName", "connection", "默认数据库", "如：wb_data", "text", true, null),
                    new PluginFieldDescriptor("username", "authentication", "用户名", "root", "text", true, null),
                    new PluginFieldDescriptor("password", "authentication", "密码", "请输入数据库密码", "password", false, null)
            )
    );

    @Override
    public DataSourcePluginDescriptor descriptor() {
        return DESCRIPTOR;
    }

    @Override
    protected String driverClassName() {
        return "com.mysql.cj.jdbc.Driver";
    }

    @Override
    protected String buildJdbcUrl(DataSourceConnectionInfo connectionInfo) {
        String jdbcParams = validateAndNormalizeJdbcParams(
                connectionParam(connectionInfo.connectionParams(), "jdbcParams"),
                ALLOWED_JDBC_PARAMS
        );
        String suffix = jdbcParams == null ? "useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC" : jdbcParams;
        return String.format(
                "jdbc:mysql://%s:%s/%s?%s",
                validateHost(connectionInfo.host()),
                validatePort(connectionInfo.port(), "3306"),
                validateDatabaseName(connectionInfo.databaseName(), "mysql"),
                suffix
        );
    }
}
