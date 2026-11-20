package com.wbdata.datasource.plugin;

import com.wbdata.datasource.entity.DataSource;
import com.wbdata.plugin.api.DataSourceConnectionInfo;
import org.springframework.stereotype.Component;

/**
 * 后端 DataSource 实体到插件 DataSourceConnectionInfo 的唯一组装点。
 *
 * <p>测试连接通过 {@link #bypassingPool(DataSource)} 省略 dataSourceId，实际直连绕过连接池由 {@code AbstractJdbcDataSourcePlugin.testConnectionDetailed} 保证。</p>
 */
@Component
public final class DataSourceConnectionInfoFactory {

    /** 常规执行路径：带 dataSourceId，优先使用连接池。 */
    public DataSourceConnectionInfo pooled(DataSource dataSource) {
        return build(dataSource, dataSource.getId());
    }

    /** 测试连接路径：省略 dataSourceId，配合插件 testConnectionDetailed 直连验证。 */
    public DataSourceConnectionInfo bypassingPool(DataSource dataSource) {
        return build(dataSource, null);
    }

    /** 覆盖库名的变体：画布/查询场景允许在请求里指定其他 database。空串回退数据源默认库。 */
    public DataSourceConnectionInfo pooled(DataSource dataSource, String databaseNameOverride) {
        String databaseName = databaseNameOverride != null && !databaseNameOverride.isEmpty()
                ? databaseNameOverride : dataSource.getDatabaseName();        return new DataSourceConnectionInfo(
                dataSource.getId(),
                dataSource.getType(),
                dataSource.getHost(),
                dataSource.getPort(),
                databaseName,
                dataSource.getUsername(),
                dataSource.getPassword(),
                dataSource.getConnectionParams());
    }

    private DataSourceConnectionInfo build(DataSource dataSource, Long dataSourceId) {
        return new DataSourceConnectionInfo(
                dataSourceId,
                dataSource.getType(),
                dataSource.getHost(),
                dataSource.getPort(),
                dataSource.getDatabaseName(),
                dataSource.getUsername(),
                dataSource.getPassword(),
                dataSource.getConnectionParams());
    }
}
