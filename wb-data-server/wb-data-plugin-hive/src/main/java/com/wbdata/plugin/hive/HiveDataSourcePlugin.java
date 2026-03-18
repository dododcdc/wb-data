package com.wbdata.plugin.hive;

import com.wbdata.plugin.api.AbstractJdbcDataSourcePlugin;
import com.wbdata.plugin.api.DataSourceConnectionInfo;
import com.wbdata.plugin.api.DataSourcePluginDescriptor;
import com.wbdata.plugin.api.PluginFieldDescriptor;

import java.util.List;

public final class HiveDataSourcePlugin extends AbstractJdbcDataSourcePlugin {

    private static final DataSourcePluginDescriptor DESCRIPTOR = new DataSourcePluginDescriptor(
            "HIVE",
            "Hive",
            20,
            "当前版本通过 HiveServer2 Binary 直连，默认端口 10000。",
            true,
            List.of(
                    new PluginFieldDescriptor("host", "connection", "HiveServer2 地址", "hive-server.example.com", "text", true, null),
                    new PluginFieldDescriptor("port", "connection", "端口", "10000", "text", true, "10000"),
                    new PluginFieldDescriptor("databaseName", "connection", "默认数据库", "如：default", "text", true, "default"),
                    new PluginFieldDescriptor("username", "authentication", "用户名", "hive_user", "text", true, null),
                    new PluginFieldDescriptor("password", "authentication", "密码", "按认证方式填写", "password", false, null)
            )
    );

    @Override
    public DataSourcePluginDescriptor descriptor() {
        return DESCRIPTOR;
    }

    @Override
    protected String driverClassName() {
        return "org.apache.hive.jdbc.HiveDriver";
    }

    @Override
    protected String buildJdbcUrl(DataSourceConnectionInfo connectionInfo) {
        return String.format(
                "jdbc:hive2://%s:%s/%s",
                connectionInfo.host(),
                defaultPort(connectionInfo.port(), "10000"),
                defaultDatabase(connectionInfo.databaseName(), "default")
        );
    }
}
