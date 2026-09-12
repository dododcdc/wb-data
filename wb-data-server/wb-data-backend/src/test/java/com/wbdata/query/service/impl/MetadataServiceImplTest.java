package com.wbdata.query.service.impl;

import com.wbdata.datasource.entity.DataSource;
import com.wbdata.datasource.plugin.DataSourcePluginRegistry;
import com.wbdata.datasource.service.DataSourceService;
import com.wbdata.plugin.api.DataSourcePlugin;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

class MetadataServiceImplTest {

    private final DataSourceService dataSourceService = Mockito.mock(DataSourceService.class);
    private final DataSourcePluginRegistry pluginRegistry = Mockito.mock(DataSourcePluginRegistry.class);
    private final DataSourcePlugin plugin = Mockito.mock(DataSourcePlugin.class);
    private final MetadataServiceImpl service = new MetadataServiceImpl(dataSourceService, pluginRegistry);

    @Test
    void missingDataSourceReturnsEmptyInsteadOfThrowing() {
        when(dataSourceService.getById(99L)).thenReturn(null);

        assertThat(service.getDatabases(99L)).isEmpty();
        assertThat(service.getTables(99L, "db", null, 1, 200).data()).isEmpty();
        assertThat(service.getColumns(99L, "db", "t")).isEmpty();
        assertThat(service.getDialectMetadata(99L).keywords()).isEmpty();
    }

    @Test
    void missingPluginReturnsEmptyInsteadOfThrowing() {
        when(dataSourceService.getById(1L)).thenReturn(dataSource());
        when(pluginRegistry.getPlugin("MYSQL")).thenReturn(Optional.empty());

        assertThat(service.getDatabases(1L)).isEmpty();
        assertThat(service.getTables(1L, "db", null, 1, 200).data()).isEmpty();
        assertThat(service.getColumns(1L, "db", "t")).isEmpty();
    }

    @Test
    void delegatesToPluginWhenDataSourceAndPluginExist() {
        when(dataSourceService.getById(1L)).thenReturn(dataSource());
        when(pluginRegistry.getPlugin("MYSQL")).thenReturn(Optional.of(plugin));
        when(plugin.getDatabases(Mockito.any())).thenReturn(List.of("db1", "db2"));

        assertThat(service.getDatabases(1L)).containsExactly("db1", "db2");
    }

    private static DataSource dataSource() {
        DataSource ds = new DataSource();
        ds.setId(1L);
        ds.setType("MYSQL");
        ds.setHost("localhost");
        return ds;
    }
}
