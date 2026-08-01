package com.wbdata.offline.transfer.service;

import com.wbdata.datasource.entity.DataSource;
import com.wbdata.datasource.plugin.DataSourcePluginRegistry;
import com.wbdata.datasource.service.DataSourceService;
import com.wbdata.offline.transfer.dto.TransferTableMetadataResponse;
import com.wbdata.plugin.api.ColumnMetadata;
import com.wbdata.plugin.api.DataSourcePlugin;
import com.wbdata.plugin.api.PartitionColumnMetadata;
import com.wbdata.plugin.api.TableDetail;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class TransferMetadataServiceTest {

    @Test
    void returnsDatabasesFromSupportedDatasourcePlugin() {
        DataSourceService dataSourceService = mock(DataSourceService.class);
        DataSourcePluginRegistry pluginRegistry = mock(DataSourcePluginRegistry.class);
        DataSourcePlugin plugin = mock(DataSourcePlugin.class);
        DataSource source = dataSource(11L, "MYSQL");
        when(dataSourceService.getById(11L)).thenReturn(source);
        when(pluginRegistry.getPlugin("MYSQL")).thenReturn(Optional.of(plugin));
        when(plugin.getDatabases(org.mockito.ArgumentMatchers.any()))
                .thenReturn(List.of("transfer_demo", "archive"));

        TransferMetadataService service = new TransferMetadataService(dataSourceService, pluginRegistry);

        assertThat(service.getDatabases(11L)).containsExactly("transfer_demo", "archive");
    }

    @Test
    void rejectsDatabaseListingForUnsupportedDatasourceType() {
        DataSourceService dataSourceService = mock(DataSourceService.class);
        DataSourcePluginRegistry pluginRegistry = mock(DataSourcePluginRegistry.class);
        when(dataSourceService.getById(12L)).thenReturn(dataSource(12L, "ORACLE"));
        TransferMetadataService service = new TransferMetadataService(dataSourceService, pluginRegistry);

        assertThatThrownBy(() -> service.getDatabases(12L))
                .hasMessageContaining("暂不支持的数据源类型: ORACLE");
    }

    @Test
    void hivePartitionedTargetReturnsDetectedPartitionsAndPartitionWriteMode() {
        DataSourceService dataSourceService = mock(DataSourceService.class);
        DataSourcePluginRegistry pluginRegistry = mock(DataSourcePluginRegistry.class);
        DataSourcePlugin plugin = mock(DataSourcePlugin.class);
        DataSource source = dataSource(9L, "HIVE");
        when(dataSourceService.getById(9L)).thenReturn(source);
        when(pluginRegistry.getPlugin("HIVE")).thenReturn(Optional.of(plugin));
        when(plugin.getTableDetail(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.eq("warehouse"), org.mockito.ArgumentMatchers.eq("daily_orders")))
                .thenReturn(new TableDetail(
                        List.of(column("order_id")),
                        List.of(new PartitionColumnMetadata("dayno", "string", "business day")),
                        true));

        TransferMetadataService service = new TransferMetadataService(dataSourceService, pluginRegistry);

        TransferTableMetadataResponse response = service.getTableMetadata(9L, "warehouse", "daily_orders");

        assertThat(response.columns()).extracting(ColumnMetadata::name).containsExactly("order_id");
        assertThat(response.partitionColumns()).extracting(PartitionColumnMetadata::name).containsExactly("dayno");
        assertThat(response.partitioned()).isTrue();
        assertThat(response.writeModes()).extracting(mode -> mode.value())
                .containsExactly("append", "overwrite_partition");
    }

    @Test
    void nonPartitionedTargetReturnsTableOverwriteMode() {
        DataSourceService dataSourceService = mock(DataSourceService.class);
        DataSourcePluginRegistry pluginRegistry = mock(DataSourcePluginRegistry.class);
        DataSourcePlugin plugin = mock(DataSourcePlugin.class);
        DataSource source = dataSource(10L, "MYSQL");
        when(dataSourceService.getById(10L)).thenReturn(source);
        when(pluginRegistry.getPlugin("MYSQL")).thenReturn(Optional.of(plugin));
        when(plugin.getTableDetail(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString()))
                .thenReturn(new TableDetail(List.of(column("order_id")), List.of(), false));

        TransferMetadataService service = new TransferMetadataService(dataSourceService, pluginRegistry);

        TransferTableMetadataResponse response = service.getTableMetadata(10L, "app", "orders");

        assertThat(response.partitionColumns()).isEmpty();
        assertThat(response.partitioned()).isFalse();
        assertThat(response.writeModes()).extracting(mode -> mode.value())
                .containsExactly("append", "overwrite_table");
    }

    private DataSource dataSource(Long id, String type) {
        DataSource dataSource = new DataSource();
        dataSource.setId(id);
        dataSource.setType(type);
        dataSource.setHost("localhost");
        dataSource.setPort(3306);
        dataSource.setDatabaseName("default");
        dataSource.setConnectionParams(java.util.Map.of());
        return dataSource;
    }

    private ColumnMetadata column(String name) {
        return new ColumnMetadata(name, "bigint", 0, false, "", false);
    }
}
