package com.wbdata.offline.transfer.controller;

import com.wbdata.auth.context.RequireGroupAuth;
import com.wbdata.auth.dto.AuthContextResponse;
import com.wbdata.auth.enums.Permission;
import com.wbdata.auth.service.AuthorizedDataSourceService;
import com.wbdata.datasource.entity.DataSource;
import com.wbdata.offline.transfer.service.TransferMetadataService;
import com.wbdata.plugin.api.PageResult;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Method;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class TransferMetadataControllerPermissionTest {

    @Test
    void metadataEndpointsRequireOfflineRead() throws Exception {
        Method tables = TransferMetadataController.class.getMethod(
                "getTables", AuthContextResponse.class, Long.class, Long.class, String.class, String.class, int.class, int.class);
        Method metadata = TransferMetadataController.class.getMethod(
                "getTableMetadata", AuthContextResponse.class, Long.class, Long.class, String.class, String.class);

        assertThat(auth(tables).value()).isEqualTo(Permission.OFFLINE_READ);
        assertThat(auth(metadata).value()).isEqualTo(Permission.OFFLINE_READ);
    }

    @Test
    void tableSearchRequiresDataSourceReadPermission() {
        TransferMetadataService metadataService = mock(TransferMetadataService.class);
        AuthorizedDataSourceService authorizedDataSourceService = mock(AuthorizedDataSourceService.class);
        DataSource dataSource = new DataSource();
        dataSource.setGroupId(4L);
        when(authorizedDataSourceService.requireDataSource(11676L, Permission.DATASOURCE_READ.code())).thenReturn(dataSource);
        when(metadataService.getTables(11676L, "warehouse", null, 1, 200))
                .thenReturn(new PageResult<>(List.of(), 0, 1, 200));
        TransferMetadataController controller = new TransferMetadataController(metadataService, authorizedDataSourceService);

        controller.getTables(null, 4L, 11676L, "warehouse", null, 1, 200);

        verify(authorizedDataSourceService).requireDataSource(11676L, Permission.DATASOURCE_READ.code());
    }

    private RequireGroupAuth auth(Method method) {
        return (RequireGroupAuth) method.getParameters()[0].getAnnotations()[0];
    }
}
