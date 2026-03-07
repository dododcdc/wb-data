package com.wbdata.plugin.starrocks;

import com.wbdata.plugin.api.AbstractJdbcDataSourcePlugin;
import com.wbdata.plugin.api.ConnectionTestRequest;
import com.wbdata.plugin.api.DataSourcePluginDescriptor;
import com.wbdata.plugin.api.PluginFieldDescriptor;

import java.util.List;

public final class StarRocksDataSourcePlugin extends AbstractJdbcDataSourcePlugin {

    private static final DataSourcePluginDescriptor DESCRIPTOR = new DataSourcePluginDescriptor(
            "STARROCKS",
            "StarRocks",
            30,
            "通过 FE 节点的 MySQL 协议接入，默认端口 9030。",
            true,
            List.of(
                    new PluginFieldDescriptor("host", "connection", "FE 节点地址", "fe.example.com", "text", true, null),
                    new PluginFieldDescriptor("port", "connection", "端口", "9030", "text", true, "9030"),
                    new PluginFieldDescriptor("databaseName", "connection", "默认数据库", "如：analytics", "text", true, null),
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
    protected String buildJdbcUrl(ConnectionTestRequest request) {
        String jdbcParams = connectionParam(request.connectionParams(), "jdbcParams");
        String suffix = jdbcParams == null ? "useSSL=false&serverTimezone=UTC&characterEncoding=utf8" : jdbcParams;
        return String.format(
                "jdbc:mysql://%s:%s/%s?%s",
                request.host(),
                defaultPort(request.port(), "9030"),
                defaultDatabase(request.databaseName(), "default_catalog"),
                suffix
        );
    }
}
