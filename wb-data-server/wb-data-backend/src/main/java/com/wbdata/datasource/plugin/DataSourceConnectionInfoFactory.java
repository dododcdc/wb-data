package com.wbdata.datasource.plugin;

import com.wbdata.datasource.entity.DataSource;
import com.wbdata.plugin.api.DataSourceConnectionInfo;
import org.springframework.stereotype.Component;

/**
 * 后端 DataSource 实体到插件 DataSourceConnectionInfo 的唯一组装点。
 *
 * <p>测试连接必须绕过连接池：dataSourceId 是连接池缓存键，传 null 强制走直连，
 * 验证的是"此刻这份配置能否连通"而非池中旧连接是否存活。</p>
 */
@Component
public final class DataSourceConnectionInfoFactory {

    /** 常规执行路径：带 dataSourceId，优先使用连接池。 */
    public DataSourceConnectionInfo pooled(DataSource dataSource) {
        return build(dataSource, dataSource.getId());
    }

    /** 测试连接路径：dataSourceId 传 null，绕过连接池直连验证。 */
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
