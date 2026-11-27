package com.wbdata.datasource.controller;

import com.wbdata.auth.enums.Permission;

import com.wbdata.auth.context.GroupAuthContext;
import com.wbdata.auth.service.AuthSession;
import com.wbdata.datasource.dto.DataSourceSaveDTO;
import com.wbdata.datasource.service.AuthorizedDataSourceService;
import com.wbdata.datasource.entity.DataSource;
import com.wbdata.datasource.plugin.DataSourceConnectionPoolManager;
import com.wbdata.datasource.plugin.DataSourcePluginRegistry;
import com.wbdata.datasource.service.DataSourceService;
import com.wbdata.group.dto.GroupOwnerInfo;
import com.wbdata.group.dto.TransferOwnerRequest;
import com.wbdata.group.dto.TransferOwnerResponse;
import com.wbdata.group.service.GroupOwnerService;
import com.wbdata.plugin.api.DataSourceException;
import com.wbdata.plugin.api.DataSourcePlugin;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class DataSourceControllerGroupScopeTest {

    @Test
    void getByIdRejectsDataSourceOutsidePathGroup() {
        AuthorizedDataSourceService authorizedDataSourceService = mock(AuthorizedDataSourceService.class);
        DataSourceController controller = new DataSourceController(
                mock(DataSourceService.class),
                mock(DataSourcePluginRegistry.class),
                mock(DataSourceConnectionPoolManager.class),
                authorizedDataSourceService,
                mock(GroupOwnerService.class)
        );
        DataSource dataSource = new DataSource();
        dataSource.setId(11676L);
        dataSource.setGroupId(999L);
        when(authorizedDataSourceService.requireDataSource(11676L, com.wbdata.auth.enums.Permission.DATASOURCE_READ)).thenReturn(dataSource);

        ResponseStatusException ex = assertThrows(ResponseStatusException.class, () -> controller.getById(11676L, 4L));

        assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    void updateRejectsDataSourceOutsideAuthenticatedGroup() {
        AuthorizedDataSourceService authorizedDataSourceService = mock(AuthorizedDataSourceService.class);
        DataSourceController controller = new DataSourceController(
                mock(DataSourceService.class),
                mock(DataSourcePluginRegistry.class),
                mock(DataSourceConnectionPoolManager.class),
                authorizedDataSourceService,
                mock(GroupOwnerService.class)
        );
        DataSource dataSource = new DataSource();
        dataSource.setId(11676L);
        dataSource.setGroupId(999L);
        when(authorizedDataSourceService.requireDataSource(11676L, com.wbdata.auth.enums.Permission.DATASOURCE_WRITE)).thenReturn(dataSource);

        ResponseStatusException ex = assertThrows(ResponseStatusException.class, () -> controller.update(
                context(4L),
                11676L,
                null
        ));

        assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    void saveRejectsInvalidConnectionInfoBeforePersisting() {
        DataSourceService dataSourceService = mock(DataSourceService.class);
        DataSourcePluginRegistry pluginRegistry = mock(DataSourcePluginRegistry.class);
        GroupOwnerService groupOwnerService = mock(GroupOwnerService.class);
        DataSourcePlugin plugin = mock(DataSourcePlugin.class);
        when(pluginRegistry.getPlugin("MYSQL")).thenReturn(Optional.of(plugin));
        when(groupOwnerService.requireAssignableOwner(4L, 1L))
                .thenReturn(new GroupOwnerInfo(1L, "admin", "管理员", "ACTIVE"));
        doThrow(new DataSourceException("不允许的 JDBC 连接参数: allowLoadLocalInfile"))
                .when(plugin).validateConnectionInfo(any());

        DataSourceController controller = new DataSourceController(
                dataSourceService,
                pluginRegistry,
                mock(DataSourceConnectionPoolManager.class),
                mock(AuthorizedDataSourceService.class),
                groupOwnerService
        );
        DataSourceSaveDTO dto = new DataSourceSaveDTO();
        dto.setName("bad-ds");
        dto.setType("MYSQL");
        dto.setHost("localhost");
        dto.setPort(3306);
        dto.setDatabaseName("demo");
        dto.setUsername("root");
        dto.setConnectionParams(Map.of("jdbcParams", "allowLoadLocalInfile=true"));

        ResponseStatusException ex = assertThrows(ResponseStatusException.class, () -> controller.save(context(4L), dto));

        assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(ex.getReason()).contains("allowLoadLocalInfile");
        verify(dataSourceService, never()).save(any());
    }

    @Test
    void saveAssignsSelectedGroupOwnerAndTransferOwnerDelegates() {
        DataSourceService dataSourceService = mock(DataSourceService.class);
        DataSourcePluginRegistry pluginRegistry = mock(DataSourcePluginRegistry.class);
        GroupOwnerService groupOwnerService = mock(GroupOwnerService.class);
        DataSourcePlugin plugin = mock(DataSourcePlugin.class);
        when(pluginRegistry.getPlugin("MYSQL")).thenReturn(Optional.of(plugin));
        when(groupOwnerService.requireAssignableOwner(4L, 8L))
                .thenReturn(new GroupOwnerInfo(8L, "xiaohong", "小红", "ACTIVE"));
        when(dataSourceService.save(any())).thenReturn(true);
        when(dataSourceService.transferOwner(4L, null, 7L, 8L, "小红", 1L)).thenReturn(10);

        DataSourceController controller = new DataSourceController(
                dataSourceService,
                pluginRegistry,
                mock(DataSourceConnectionPoolManager.class),
                mock(AuthorizedDataSourceService.class),
                groupOwnerService
        );
        DataSourceSaveDTO dto = new DataSourceSaveDTO();
        dto.setName("prod-ds");
        dto.setType("MYSQL");
        dto.setHost("omarchy.local");
        dto.setPort(3306);
        dto.setDatabaseName("demo");
        dto.setUsername("root");
        dto.setOwnerUserId(8L);

        controller.save(context(4L), dto);

        ArgumentCaptor<DataSource> captor = ArgumentCaptor.forClass(DataSource.class);
        verify(dataSourceService).save(captor.capture());
        assertThat(captor.getValue().getOwnerUserId()).isEqualTo(8L);
        assertThat(captor.getValue().getOwner()).isEqualTo("小红");

        TransferOwnerResponse response = controller.transferOwner(
                context(4L),
                new TransferOwnerRequest(null, 7L, 8L)
        ).getData();
        assertThat(response.updatedCount()).isEqualTo(10);
        assertThat(response.targetOwnerUserId()).isEqualTo(8L);
        assertThat(response.targetOwnerName()).isEqualTo("小红");
    }

    private GroupAuthContext context(Long groupId) {
        return new GroupAuthContext(
                new AuthSession(1L, "admin", "admin", "ADMIN", Instant.now().plusSeconds(3600)),
                groupId,
                "policy"
        );
    }
}
