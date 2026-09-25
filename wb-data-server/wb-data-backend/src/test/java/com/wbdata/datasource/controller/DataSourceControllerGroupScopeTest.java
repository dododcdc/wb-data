package com.wbdata.datasource.controller;

import com.wbdata.auth.context.GroupAuthContext;
import com.wbdata.auth.service.AuthSession;
import com.wbdata.auth.service.AuthorizedDataSourceService;
import com.wbdata.datasource.entity.DataSource;
import com.wbdata.datasource.plugin.DataSourceConnectionPoolManager;
import com.wbdata.datasource.plugin.DataSourcePluginRegistry;
import com.wbdata.datasource.service.DataSourceService;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class DataSourceControllerGroupScopeTest {

    @Test
    void getByIdRejectsDataSourceOutsidePathGroup() {
        AuthorizedDataSourceService authorizedDataSourceService = mock(AuthorizedDataSourceService.class);
        DataSourceController controller = new DataSourceController(
                mock(DataSourceService.class),
                mock(DataSourcePluginRegistry.class),
                mock(DataSourceConnectionPoolManager.class),
                authorizedDataSourceService
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
                authorizedDataSourceService
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

    private GroupAuthContext context(Long groupId) {
        return new GroupAuthContext(
                new AuthSession(1L, "admin", "admin", "ADMIN", Instant.now().plusSeconds(3600)),
                groupId,
                "policy"
        );
    }
}
