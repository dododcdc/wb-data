package com.wbdata.datasource.plugin;

import com.wbdata.datasource.entity.DataSource;
import com.wbdata.plugin.api.DataSourceConnectionInfo;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class DataSourceConnectionInfoFactoryTest {

    private final DataSourceConnectionInfoFactory factory = new DataSourceConnectionInfoFactory();

    @Test
    void pooled_keepsDataSourceIdAsPoolKey() {
        DataSource ds = sample();

        DataSourceConnectionInfo info = factory.pooled(ds);

        assertThat(info.dataSourceId()).isEqualTo(42L);
        assertThat(info.type()).isEqualTo("MYSQL");
        assertThat(info.host()).isEqualTo("db.example");
        assertThat(info.port()).isEqualTo(3306);
        assertThat(info.databaseName()).isEqualTo("warehouse");
        assertThat(info.username()).isEqualTo("analyst");
        assertThat(info.password()).isEqualTo("secret");
        assertThat(info.connectionParams()).isEqualTo(Map.of("k", "v"));
    }

    @Test
    void bypassingPool_clearsDataSourceIdToForceDirectConnection() {
        DataSourceConnectionInfo info = factory.bypassingPool(sample());

        assertThat(info.dataSourceId()).isNull();
        assertThat(info.type()).isEqualTo("MYSQL");
    }

    @Test
    void pooled_withDatabaseOverride_replacesDatabaseWhenPresent() {
        DataSource ds = sample();

        assertThat(factory.pooled(ds, "other_db").databaseName()).isEqualTo("other_db");
        assertThat(factory.pooled(ds, "").databaseName()).isEqualTo("warehouse");
        assertThat(factory.pooled(ds, null).databaseName()).isEqualTo("warehouse");
    }

    @Test
    void connectionParams_areWrappedUnmodifiable() {
        DataSourceConnectionInfo info = factory.pooled(sample());

        assertThatThrownByUnmodifiable(() -> info.connectionParams().put("k2", "v2"));
    }

    private static void assertThatThrownByUnmodifiable(Runnable action) {
        try {
            action.run();
            throw new AssertionError("connectionParams 应为不可变 Map");
        } catch (UnsupportedOperationException expected) {
            // record 构造器已包装为不可变
        }
    }

    private DataSource sample() {
        DataSource ds = new DataSource();
        ds.setId(42L);
        ds.setType("MYSQL");
        ds.setHost("db.example");
        ds.setPort(3306);
        ds.setDatabaseName("warehouse");
        ds.setUsername("analyst");
        ds.setPassword("secret");
        ds.setConnectionParams(Map.of("k", "v"));
        return ds;
    }
}
