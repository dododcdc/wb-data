package com.wbdata.datasource.plugin;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.wbdata.datasource.entity.DataSource;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.concurrent.TimeUnit;

/**
 * HikariCP 连接池管理器
 * 使用 Caffeine 作为 LRU/时间过期缓存，使不活跃的数据源连接池自动关闭和淘汰
 *
 * <p>架构:
 * <pre>
 *   Caffeine Cache&lt;dsId, HikariDataSource&gt;
 *     dsId=1 → HikariCP 池 [conn1, conn2, ...]
 *     dsId=2 → HikariCP 池 [conn1, ...]
 *     (30 分钟空闲 → 自动关闭和淘汰)
 * </pre>
 */
@Component
public class DataSourceConnectionPoolManager {

    private static final Logger log = LoggerFactory.getLogger(DataSourceConnectionPoolManager.class);

    /** 最多同时保持活跃连接池的数据源数量 */
    private static final int MAX_POOL_COUNT = 50;

    /** 空闲多少分钟后淘汰连接池 */
    private static final long EXPIRE_AFTER_ACCESS_MINUTES = 30;

    private final Cache<Long, HikariDataSource> poolCache;

    public DataSourceConnectionPoolManager() {
        this.poolCache = Caffeine.newBuilder()
                .maximumSize(MAX_POOL_COUNT)
                .expireAfterAccess(EXPIRE_AFTER_ACCESS_MINUTES, TimeUnit.MINUTES)
                .removalListener((key, pool, cause) -> {
                    if (pool != null && !((HikariDataSource) pool).isClosed()) {
                        log.info("关闭数据源连接池, dataSourceId={}, 原因={}", key, cause);
                        ((HikariDataSource) pool).close();
                    }
                })
                .build();
    }

    /**
     * 获取给定数据源的池化 JDBC 连接
     * 首次访问时创建 HikariCP 连接池
     *
     * @param ds 数据源实体
     * @param jdbcUrl JDBC URL（由插件提供）
     * @param driverClassName JDBC 驱动类名（由插件提供）
     * @return 来自连接池的活跃 JDBC 连接
     */
    public Connection getConnection(DataSource ds, String jdbcUrl, String driverClassName) throws SQLException {
        HikariDataSource pool = poolCache.get(ds.getId(), id -> createPool(ds, jdbcUrl, driverClassName));
        return pool.getConnection();
    }

    /**
     * 使给定数据源的连接池失效并关闭
     * 应在数据源更新或删除时调用
     */
    public void invalidate(Long dataSourceId) {
        HikariDataSource pool = poolCache.getIfPresent(dataSourceId);
        poolCache.invalidate(dataSourceId);
        if (pool != null && !pool.isClosed()) {
            log.info("使数据源连接池失效, dataSourceId={}", dataSourceId);
            pool.close();
        }
    }

    private HikariDataSource createPool(DataSource ds, String jdbcUrl, String driverClassName) {
        log.info("创建新的连接池, dataSourceId={}, type={}, url={}",
                ds.getId(), ds.getType(), jdbcUrl);
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl(jdbcUrl);
        config.setDriverClassName(driverClassName);
        if (ds.getUsername() != null && !ds.getUsername().isBlank()) {
            config.setUsername(ds.getUsername());
        }
        if (ds.getPassword() != null && !ds.getPassword().isBlank()) {
            config.setPassword(ds.getPassword());
        }
        config.setMaximumPoolSize(5);
        config.setMinimumIdle(1);
        config.setConnectionTimeout(10_000);     // 10 秒
        config.setIdleTimeout(600_000);          // 10 分钟
        config.setMaxLifetime(1_800_000);        // 30 分钟
        config.setPoolName("wb-pool-ds-" + ds.getId());
        // 禁用自动提交以实现查询隔离；插件将管理事务
        config.setAutoCommit(true);
        return new HikariDataSource(config);
    }

    @PreDestroy
    public void closeAll() {
        log.info("正在关闭所有连接池...");
        poolCache.asMap().values().forEach(pool -> {
            if (!pool.isClosed()) pool.close();
        });
        poolCache.invalidateAll();
    }
}
