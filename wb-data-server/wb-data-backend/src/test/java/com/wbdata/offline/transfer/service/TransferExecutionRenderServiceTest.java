package com.wbdata.offline.transfer.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wbdata.datasource.entity.DataSource;
import com.wbdata.offline.config.OfflineTransferProperties;
import com.wbdata.offline.transfer.config.TransferInternalProperties;
import com.wbdata.offline.transfer.dto.TransferConfig;
import com.wbdata.offline.transfer.dto.TransferEndpointConfig;
import com.wbdata.offline.transfer.dto.TransferFieldMapping;
import com.wbdata.offline.transfer.dto.TransferMappingKind;
import com.wbdata.offline.transfer.dto.TransferRenderRequest;
import com.wbdata.offline.transfer.dto.TransferWriteMode;
import com.wbdata.plugin.api.ColumnMetadata;
import com.wbdata.plugin.api.TableDetail;
import jakarta.validation.Validation;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class TransferExecutionRenderServiceTest {

    @Test
    void missingOrWrongTokenIsRejected() {
        TransferMetadataService metadataService = mock(TransferMetadataService.class);
        TransferExecutionRenderService service = service(metadataService);

        assertUnauthorized(() -> service.render(null, request(), Map.of()));
        assertUnauthorized(() -> service.render("wrong-token", request(), Map.of()));
    }

    @Test
    void groupMismatchFailsBeforeMetadataIsRead() {
        TransferMetadataService metadataService = mock(TransferMetadataService.class);
        when(metadataService.requireSupportedDataSource(1L)).thenReturn(dataSource(1L, 5L, "source-password"));
        when(metadataService.requireSupportedDataSource(2L)).thenReturn(dataSource(2L, 4L, "target-password"));
        TransferExecutionRenderService service = service(metadataService);

        assertThatThrownBy(() -> service.render("internal-token", request(), Map.of()))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(exception -> ((ResponseStatusException) exception).getStatusCode())
                .isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    void rendersFreshMetadataAndKeepsPasswordsOutOfSidecarJson() throws Exception {
        TransferMetadataService metadataService = mock(TransferMetadataService.class);
        DataSource source = dataSource(1L, 4L, "source-password");
        DataSource target = dataSource(2L, 4L, "target-password");
        TableDetail sourceTable = table("id");
        TableDetail targetTable = table("order_id");
        when(metadataService.requireSupportedDataSource(1L)).thenReturn(source);
        when(metadataService.requireSupportedDataSource(2L)).thenReturn(target);
        when(metadataService.getTableDetail(eq(source), eq("sales"), eq("orders"))).thenReturn(sourceTable);
        when(metadataService.getTableDetail(eq(target), eq("warehouse"), eq("dwd_orders"))).thenReturn(targetTable);
        TransferExecutionRenderService service = service(metadataService);

        String rendered = service.render("internal-token", request(), Map.of());
        String sidecarJson = new TransferConfigFileService(new ObjectMapper())
                .serialize(4L, "_flows/orders/flow.yaml", "transfer_1", request().transferConfig());

        assertThat(rendered).contains("password = \"source-password\"", "password = \"target-password\"");
        assertThat(sidecarJson).doesNotContain("source-password", "target-password", "password");
        verify(metadataService).getTableDetail(source, "sales", "orders");
        verify(metadataService).getTableDetail(target, "warehouse", "dwd_orders");
    }

    @Test
    void hiveTargetWithoutMetastoreUriIsRejectedBeforeRendering() {
        TransferMetadataService metadataService = mock(TransferMetadataService.class);
        DataSource source = dataSource(1L, 4L, "source-password");
        DataSource target = dataSource(2L, 4L, "target-password");
        target.setType("HIVE");
        target.setConnectionParams(Map.of());
        when(metadataService.requireSupportedDataSource(1L)).thenReturn(source);
        when(metadataService.requireSupportedDataSource(2L)).thenReturn(target);
        when(metadataService.getTableDetail(eq(source), eq("sales"), eq("orders"))).thenReturn(table("order_id"));
        when(metadataService.getTableDetail(eq(target), eq("warehouse"), eq("dwd_orders"))).thenReturn(table("order_id"));
        TransferExecutionRenderService service = service(metadataService);

        assertThatThrownBy(() -> service.render("internal-token", hiveTargetRequest(), Map.of()))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(exception -> ((ResponseStatusException) exception).getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    void hiveTargetWithMetastoreUriRendersConfig() {
        TransferMetadataService metadataService = mock(TransferMetadataService.class);
        DataSource source = dataSource(1L, 4L, "source-password");
        DataSource target = dataSource(2L, 4L, "target-password");
        target.setType("HIVE");
        target.setConnectionParams(Map.of("metastoreUri", "thrift://host.docker.internal:9083"));
        when(metadataService.requireSupportedDataSource(1L)).thenReturn(source);
        when(metadataService.requireSupportedDataSource(2L)).thenReturn(target);
        when(metadataService.getTableDetail(eq(source), eq("sales"), eq("orders"))).thenReturn(table("order_id"));
        when(metadataService.getTableDetail(eq(target), eq("warehouse"), eq("dwd_orders"))).thenReturn(table("order_id"));
        TransferExecutionRenderService service = service(metadataService);

        assertThat(service.render("internal-token", hiveTargetRequest(), Map.of()))
                .contains("metastore_uri = \"thrift://host.docker.internal:9083\"");
    }

    @Test
    void missingPostSqlParameterIsRejectedBeforeTableMetadataQueries() {
        TransferMetadataService metadataService = mock(TransferMetadataService.class);
        when(metadataService.requireSupportedDataSource(1L)).thenReturn(dataSource(1L, 4L, "source-password"));
        when(metadataService.requireSupportedDataSource(2L)).thenReturn(dataSource(2L, 4L, "target-password"));
        TransferRenderRequest base = request();
        TransferRenderRequest request = new TransferRenderRequest(base.groupId(), base.source(),
                new TransferEndpointConfig(2L, "MYSQL", "warehouse", "dwd_orders", null, TransferWriteMode.APPEND,
                        List.of("select ^[pre]"), List.of("select ^[post]")), base.fieldMappings(), base.partitions());

        assertThatThrownBy(() -> service(metadataService).render("internal-token", request, Map.of("pre", "1")))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("未提供的参数: post")
                .extracting(e -> ((ResponseStatusException) e).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        verify(metadataService, never()).getTableDetail(any(), any(), any());
    }

    @Test
    void passesParametersThroughToFreshSourceSqlRendering() {
        TransferMetadataService metadataService = mock(TransferMetadataService.class);
        DataSource source = dataSource(1L, 4L, "source-password");
        DataSource target = dataSource(2L, 4L, "target-password");
        when(metadataService.requireSupportedDataSource(1L)).thenReturn(source);
        when(metadataService.requireSupportedDataSource(2L)).thenReturn(target);
        when(metadataService.getTableDetail(source, "sales", "orders")).thenReturn(table("id"));
        when(metadataService.getTableDetail(target, "warehouse", "dwd_orders")).thenReturn(table("order_id"));
        TransferRenderRequest base = request();
        TransferRenderRequest request = new TransferRenderRequest(base.groupId(), base.source(), base.target(),
                List.of(new TransferFieldMapping("order_id", TransferMappingKind.STATIC_VALUE, null, null, "^[value]")), List.of());

        assertThat(service(metadataService).render("internal-token", request, Map.of("value", "中文'")))
                .contains("CONVERT(X'e4b8ade6968727' USING utf8mb4) as `order_id`")
                .doesNotContain("^[value]", "中文'");
    }

    private TransferExecutionRenderService service(TransferMetadataService metadataService) {
        TransferInternalProperties properties = new TransferInternalProperties();
        properties.setInternalToken("internal-token");
        TransferExecutionGuard guard = new TransferExecutionGuard(properties, metadataService,
                Validation.buildDefaultValidatorFactory().getValidator());
        return new TransferExecutionRenderService(guard, metadataService,
                new TransferSeatunnelConfigBuilder(new OfflineTransferProperties()));
    }

    private TransferRenderRequest request() {
        TransferConfig config = new TransferConfig(
                new TransferEndpointConfig(1L, "MYSQL", "sales", "orders", null, null, null, null),
                new TransferEndpointConfig(2L, "MYSQL", "warehouse", "dwd_orders", null, TransferWriteMode.APPEND, null, null),
                List.of(new TransferFieldMapping("order_id", TransferMappingKind.SOURCE_FIELD, "id", null)),
                List.of());
        return new TransferRenderRequest(4L, config.source(), config.target(), config.fieldMappings(), config.partitions());
    }

    private TransferRenderRequest hiveTargetRequest() {
        TransferConfig config = new TransferConfig(
                new TransferEndpointConfig(1L, "MYSQL", "sales", "orders", null, null, null, null),
                new TransferEndpointConfig(2L, "HIVE", "warehouse", "dwd_orders", null, TransferWriteMode.APPEND, null, null),
                List.of(new TransferFieldMapping("order_id", TransferMappingKind.SOURCE_FIELD, "order_id", null)),
                List.of());
        return new TransferRenderRequest(4L, config.source(), config.target(), config.fieldMappings(), config.partitions());
    }

    private DataSource dataSource(Long id, Long groupId, String password) {
        DataSource dataSource = new DataSource();
        dataSource.setId(id);
        dataSource.setGroupId(groupId);
        dataSource.setType("MYSQL");
        dataSource.setHost("localhost");
        dataSource.setPort(3306);
        dataSource.setDatabaseName("default");
        dataSource.setUsername("user");
        dataSource.setPassword(password);
        return dataSource;
    }

    private TableDetail table(String column) {
        return new TableDetail(List.of(new ColumnMetadata(column, "bigint", 0, false, "", false)), List.of(), false);
    }

    private void assertUnauthorized(org.assertj.core.api.ThrowableAssert.ThrowingCallable callable) {
        assertThatThrownBy(callable)
                .isInstanceOf(ResponseStatusException.class)
                .extracting(exception -> ((ResponseStatusException) exception).getStatusCode())
                .isEqualTo(HttpStatus.UNAUTHORIZED);
    }
}
