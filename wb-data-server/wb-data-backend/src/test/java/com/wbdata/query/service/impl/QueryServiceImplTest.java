package com.wbdata.query.service.impl;

import com.wbdata.datasource.entity.DataSource;
import com.wbdata.datasource.plugin.DataSourcePluginRegistry;
import com.wbdata.datasource.service.DataSourceService;
import com.wbdata.plugin.api.DataSourcePlugin;
import com.wbdata.plugin.api.QueryRequest;
import com.wbdata.plugin.api.QueryResult;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

class QueryServiceImplTest {

    private final DataSourceService dataSourceService = Mockito.mock(DataSourceService.class);
    private final DataSourcePluginRegistry pluginRegistry = Mockito.mock(DataSourcePluginRegistry.class);
    private final DataSourcePlugin plugin = Mockito.mock(DataSourcePlugin.class);
    private final QueryServiceImpl service = new QueryServiceImpl(dataSourceService, pluginRegistry);

    @Test
    void missingDataSourceThrows() {
        when(dataSourceService.getById(99L)).thenReturn(null);

        assertThatThrownBy(() -> service.executeQuery(99L, "select 1", null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("数据源不存在");
    }

    @Test
    void missingPluginThrows() {
        when(dataSourceService.getById(1L)).thenReturn(dataSource());
        when(pluginRegistry.getPlugin("UNKNOWN")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.executeQuery(1L, "select 1", null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("未找到对应类型的插件");
    }

    @Test
    void blankDatabaseFallsBackToDataSourceDefault() {
        DataSource ds = dataSource();
        when(dataSourceService.getById(1L)).thenReturn(ds);
        when(pluginRegistry.getPlugin("MYSQL")).thenReturn(Optional.of(plugin));
        QueryResult expected = new QueryResult(List.of(), List.of(), 1L, "OK", false, 0);
        when(plugin.executeQuery(any())).thenReturn(expected);

        QueryResult actual = service.executeQuery(1L, "select 1", "");

        assertThat(actual).isSameAs(expected);
        QueryRequest sent = capturedRequest();
        assertThat(sent.connectionInfo().databaseName()).isEqualTo("default_db");
    }

    @Test
    void explicitDatabaseOverridesDefaultAndRowLimitIsForwarded() {
        when(dataSourceService.getById(1L)).thenReturn(dataSource());
        when(pluginRegistry.getPlugin("MYSQL")).thenReturn(Optional.of(plugin));
        when(plugin.executeQuery(any())).thenReturn(new QueryResult(List.of(), List.of(), 1L, "OK", false, 0));

        service.executeQuery(1L, "select 1", "other_db", 500);

        QueryRequest sent = capturedRequest();
        assertThat(sent.connectionInfo().databaseName()).isEqualTo("other_db");
        assertThat(sent.rowLimit()).isEqualTo(500);
    }

    @Test
    void connectionInfoCarriesCredentialsAndParams() {
        DataSource ds = dataSource();
        when(dataSourceService.getById(1L)).thenReturn(ds);
        when(pluginRegistry.getPlugin("MYSQL")).thenReturn(Optional.of(plugin));
        when(plugin.executeQuery(any())).thenReturn(new QueryResult(List.of(), List.of(), 1L, "OK", false, 0));

        service.executeQuery(1L, "select 1", null);

        QueryRequest sent = capturedRequest();
        assertThat(sent.connectionInfo().host()).isEqualTo("localhost");
        assertThat(sent.connectionInfo().port()).isEqualTo(3306);
        assertThat(sent.connectionInfo().username()).isEqualTo("root");
        assertThat(sent.connectionInfo().password()).isEqualTo("secret");
        assertThat(sent.connectionInfo().connectionParams()).containsEntry("useSSL", "false");
    }

    private QueryRequest capturedRequest() {
        ArgumentCaptor<QueryRequest> captor = ArgumentCaptor.forClass(QueryRequest.class);
        Mockito.verify(plugin).executeQuery(captor.capture());
        return captor.getValue();
    }

    private static DataSource dataSource() {
        DataSource ds = new DataSource();
        ds.setId(1L);
        ds.setType("MYSQL");
        ds.setHost("localhost");
        ds.setPort(3306);
        ds.setDatabaseName("default_db");
        ds.setUsername("root");
        ds.setPassword("secret");
        ds.setConnectionParams(Map.of("useSSL", "false"));
        return ds;
    }
}
