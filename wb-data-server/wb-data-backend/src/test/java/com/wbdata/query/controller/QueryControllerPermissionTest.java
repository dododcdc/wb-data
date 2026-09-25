package com.wbdata.query.controller;

import com.wbdata.auth.enums.Permission;
import com.wbdata.auth.service.AuthorizedDataSourceService;
import com.wbdata.plugin.api.QueryResult;
import com.wbdata.query.dto.QueryExportCreateRequest;
import com.wbdata.query.enums.ExportFormat;
import com.wbdata.query.service.MetadataService;
import com.wbdata.query.service.QueryExportService;
import com.wbdata.query.service.QueryService;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.core.io.ByteArrayResource;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class QueryControllerPermissionTest {

    private final MetadataService metadataService = Mockito.mock(MetadataService.class);
    private final QueryService queryService = Mockito.mock(QueryService.class);
    private final QueryExportService queryExportService = Mockito.mock(QueryExportService.class);
    private final AuthorizedDataSourceService authorizedDataSourceService = Mockito.mock(AuthorizedDataSourceService.class);
    private final QueryController controller = new QueryController(
            metadataService, queryService, queryExportService, authorizedDataSourceService);

    @Test
    void executeRequiresQueryUsePermission() {
        QueryResult result = new QueryResult(List.of(), List.of(), 1L, "OK", false, 0);
        when(queryService.executeQuery(1L, "select 1", "db")).thenReturn(result);

        assertThat(controller.execute(1L, new QueryRequest("select 1", "db")).getData()).isSameAs(result);
        verify(authorizedDataSourceService).requireDataSource(1L, Permission.QUERY_USE);
    }

    @Test
    void metadataEndpointsRequireQueryUsePermission() {
        controller.getDatabases(1L);
        controller.getTables(2L, "db", null, 1, 200);
        controller.getColumns(3L, "db", "table");
        controller.getDialectMetadata(4L);

        for (long dataSourceId = 1; dataSourceId <= 4; dataSourceId++) {
            verify(authorizedDataSourceService).requireDataSource(dataSourceId, Permission.QUERY_USE);
        }
    }

    @Test
    void exportCreationDelegatesAuthorizationToService() {
        controller.createExportTask(1L, new QueryExportCreateRequest("select 1", "db", ExportFormat.CSV));

        verify(queryExportService).createExportTask(1L, "select 1", "db", "csv");
        verifyNoInteractions(authorizedDataSourceService);
    }

    @Test
    void exportDefaultsToCsvWhenFormatOmitted() {
        controller.createExportTask(1L, new QueryExportCreateRequest("select 1", "db", null));
        verify(queryExportService).createExportTask(1L, "select 1", "db", "csv");
    }

    @Test
    void taskListingDetailsAndDownloadDelegateAuthorizationToService() {
        ByteArrayResource resource = new ByteArrayResource(new byte[0]);
        when(queryExportService.getDownloadFileName("t1")).thenReturn("export.csv");
        when(queryExportService.getDownloadResource("t1")).thenReturn(resource);

        controller.listExportTasks();
        controller.getExportTask("t1");
        assertThat(controller.downloadExportTask("t1").getBody()).isSameAs(resource);

        verify(queryExportService).listTasks();
        verify(queryExportService).getTask("t1");
        verify(queryExportService).getDownloadFileName("t1");
        verify(queryExportService).getDownloadResource("t1");
        verifyNoInteractions(authorizedDataSourceService);
    }
}
