package com.wbdata.query.controller;

import com.wbdata.auth.service.AuthorizedDataSourceService;
import com.wbdata.plugin.api.QueryResult;
import com.wbdata.query.dto.QueryExportCreateRequest;
import com.wbdata.query.enums.ExportFormat;
import com.wbdata.query.service.MetadataService;
import com.wbdata.query.service.QueryExportService;
import com.wbdata.query.service.QueryService;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
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
        verify(authorizedDataSourceService).requireDataSource(1L, "query.use");
    }

    @Test
    void metadataEndpointsRequireQueryUsePermission() {
        controller.getDatabases(1L);
        verify(authorizedDataSourceService).requireDataSource(1L, "query.use");
    }

    @Test
    void exportCreationRequiresQueryExportPermission() {
        controller.createExportTask(1L, new QueryExportCreateRequest("select 1", "db", ExportFormat.CSV));
        verify(authorizedDataSourceService).requireDataSource(1L, "query.export");
    }

    @Test
    void exportDefaultsToCsvWhenFormatOmitted() {
        controller.createExportTask(1L, new QueryExportCreateRequest("select 1", "db", null));
        verify(queryExportService).createExportTask(1L, "select 1", "db", "csv");
    }

    @Test
    void taskListingAndDownloadRequireContext() {
        controller.listExportTasks();
        controller.getExportTask("t1");
        verify(authorizedDataSourceService, Mockito.times(2)).requireContext();
    }
}
