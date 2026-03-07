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
 * Manages HikariCP connection pools for each data source.
 * Uses Caffeine as an LRU/time-based cache so that pools for dormant
 * data sources are automatically closed and evicted.
 *
 * <p>Architecture:
 * <pre>
 *   Caffeine Cache&lt;dsId, HikariDataSource&gt;
 *     dsId=1 → HikariCP Pool [conn1, conn2, ...]
 *     dsId=2 → HikariCP Pool [conn1, ...]
 *     (30 min idle → auto-close &amp; evict)
 * </pre>
 */
@Component
public class DataSourceConnectionPoolManager {

    private static final Logger log = LoggerFactory.getLogger(DataSourceConnectionPoolManager.class);

    /** Max number of data sources to keep active pools for at once. */
    private static final int MAX_POOL_COUNT = 50;

    /** Evict a pool after this many minutes without use. */
    private static final long EXPIRE_AFTER_ACCESS_MINUTES = 30;

    private final Cache<Long, HikariDataSource> poolCache;

    public DataSourceConnectionPoolManager() {
        this.poolCache = Caffeine.newBuilder()
                .maximumSize(MAX_POOL_COUNT)
                .expireAfterAccess(EXPIRE_AFTER_ACCESS_MINUTES, TimeUnit.MINUTES)
                .removalListener((key, pool, cause) -> {
                    if (pool != null && !((HikariDataSource) pool).isClosed()) {
                        log.info("Closing connection pool for dataSourceId={}, reason={}", key, cause);
                        ((HikariDataSource) pool).close();
                    }
                })
                .build();
    }

    /**
     * Retrieves a pooled JDBC connection for the given data source.
     * Creates the HikariCP pool on first access.
     *
     * @param ds the data source entity
     * @param jdbcUrl the JDBC URL (provided by the plugin)
     * @param driverClassName the JDBC driver class name (provided by the plugin)
     * @return a live JDBC connection from the pool
     */
    public Connection getConnection(DataSource ds, String jdbcUrl, String driverClassName) throws SQLException {
        HikariDataSource pool = poolCache.get(ds.getId(), id -> createPool(ds, jdbcUrl, driverClassName));
        return pool.getConnection();
    }

    /**
     * Invalidates and closes the connection pool for a given data source.
     * Should be called when a data source is updated or deleted.
     */
    public void invalidate(Long dataSourceId) {
        HikariDataSource pool = poolCache.getIfPresent(dataSourceId);
        poolCache.invalidate(dataSourceId);
        if (pool != null && !pool.isClosed()) {
            log.info("Invalidating connection pool for dataSourceId={}", dataSourceId);
            pool.close();
        }
    }

    private HikariDataSource createPool(DataSource ds, String jdbcUrl, String driverClassName) {
        log.info("Creating new connection pool for dataSourceId={}, type={}, url={}",
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
        config.setConnectionTimeout(10_000);     // 10 seconds
        config.setIdleTimeout(600_000);          // 10 minutes
        config.setMaxLifetime(1_800_000);        // 30 minutes
        config.setPoolName("wb-pool-ds-" + ds.getId());
        // Disable auto-commit for query isolation; plugins will manage transactions
        config.setAutoCommit(true);
        return new HikariDataSource(config);
    }

    @PreDestroy
    public void closeAll() {
        log.info("Shutting down all connection pools...");
        poolCache.asMap().values().forEach(pool -> {
            if (!pool.isClosed()) pool.close();
        });
        poolCache.invalidateAll();
    }
}
