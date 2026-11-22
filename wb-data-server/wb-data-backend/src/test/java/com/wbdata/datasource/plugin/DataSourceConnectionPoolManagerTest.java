package com.wbdata.datasource.plugin;

import com.wbdata.datasource.entity.DataSource;
import com.zaxxer.hikari.HikariDataSource;
import org.junit.jupiter.api.Test;

import java.sql.Connection;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class DataSourceConnectionPoolManagerTest {

    @Test
    void isolatesPoolsPerJdbcUrlForSameDataSourceAndInvalidatesAllByDataSourceId() throws Exception {
        Map<String, HikariDataSource> createdPools = new ConcurrentHashMap<>();
        DataSourceConnectionPoolManager manager = new DataSourceConnectionPoolManager(
                (ds, jdbcUrl, driver, loader) -> {
                    HikariDataSource pool = mockPool(jdbcUrl);
                    createdPools.put(ds.getId() + "|" + jdbcUrl, pool);
                    return pool;
                });

        DataSource ds1 = dataSource(1L);
        DataSource ds2 = dataSource(2L);

        manager.getConnection(ds1, "jdbc:postgresql://pg:5432/db_a", "org.postgresql.Driver", null);
        manager.getConnection(ds1, "jdbc:postgresql://pg:5432/db_b", "org.postgresql.Driver", null);
        manager.getConnection(ds1, "jdbc:postgresql://pg:5432/db_a", "org.postgresql.Driver", null);
        manager.getConnection(ds2, "jdbc:postgresql://pg:5432/db_a", "org.postgresql.Driver", null);

        assertThat(createdPools).hasSize(3);
        verify(createdPools.get("1|jdbc:postgresql://pg:5432/db_a"), times(2)).getConnection();
        verify(createdPools.get("1|jdbc:postgresql://pg:5432/db_b"), times(1)).getConnection();

        manager.invalidate(1L);

        assertThat(createdPools.get("1|jdbc:postgresql://pg:5432/db_a").isClosed()).isTrue();
        assertThat(createdPools.get("1|jdbc:postgresql://pg:5432/db_b").isClosed()).isTrue();
        assertThat(createdPools.get("2|jdbc:postgresql://pg:5432/db_a").isClosed()).isFalse();

        manager.closeAll();
        assertThat(createdPools.get("2|jdbc:postgresql://pg:5432/db_a").isClosed()).isTrue();
    }

    private static HikariDataSource mockPool(String jdbcUrl) {
        HikariDataSource pool = mock(HikariDataSource.class, jdbcUrl);
        AtomicBoolean closed = new AtomicBoolean(false);
        try {
            when(pool.getConnection()).thenReturn(mock(Connection.class));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
        when(pool.isClosed()).thenAnswer(inv -> closed.get());
        doAnswer(inv -> {
            closed.set(true);
            return null;
        }).when(pool).close();
        return pool;
    }

    private static DataSource dataSource(Long id) {
        DataSource ds = new DataSource();
        ds.setId(id);
        ds.setType("POSTGRESQL");
        return ds;
    }
}
