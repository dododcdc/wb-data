package com.wbdata.offline.transfer.controller;

import com.wbdata.offline.transfer.dto.TransferConfig;
import com.wbdata.offline.transfer.dto.TransferEndpointConfig;
import com.wbdata.offline.transfer.dto.TransferFieldMapping;
import com.wbdata.offline.transfer.dto.TransferMappingKind;
import com.wbdata.offline.transfer.dto.TransferRenderRequest;
import com.wbdata.offline.transfer.dto.TransferWriteMode;
import com.wbdata.offline.transfer.service.TransferExecutionRenderService;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class InternalTransferControllerTest {

    @Test
    void missingTokenIsRejected() {
        TransferExecutionRenderService renderService = mock(TransferExecutionRenderService.class);
        when(renderService.render(null, request()))
                .thenThrow(new ResponseStatusException(org.springframework.http.HttpStatus.UNAUTHORIZED));
        InternalTransferController controller = new InternalTransferController(renderService);

        assertThatThrownBy(() -> controller.render(null, request()))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(exception -> ((ResponseStatusException) exception).getStatusCode())
                .isEqualTo(org.springframework.http.HttpStatus.UNAUTHORIZED);
    }

    @Test
    void wrongTokenIsRejected() {
        TransferExecutionRenderService renderService = mock(TransferExecutionRenderService.class);
        when(renderService.render("wrong", request()))
                .thenThrow(new ResponseStatusException(org.springframework.http.HttpStatus.UNAUTHORIZED));
        InternalTransferController controller = new InternalTransferController(renderService);

        assertThatThrownBy(() -> controller.render("wrong", request()))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(exception -> ((ResponseStatusException) exception).getStatusCode())
                .isEqualTo(org.springframework.http.HttpStatus.UNAUTHORIZED);
    }

    @Test
    void validTokenReturnsPlainTextConfig() {
        TransferExecutionRenderService renderService = mock(TransferExecutionRenderService.class);
        when(renderService.render("valid-token", request())).thenReturn("env {}\n");
        InternalTransferController controller = new InternalTransferController(renderService);

        var response = controller.render("valid-token", request());

        assertThat(response.getStatusCode()).isEqualTo(org.springframework.http.HttpStatus.OK);
        assertThat(response.getHeaders().getContentType()).isEqualTo(MediaType.TEXT_PLAIN);
        assertThat(response.getBody()).isEqualTo("env {}\n");
    }

    private TransferRenderRequest request() {
        TransferConfig config = new TransferConfig(
                new TransferEndpointConfig(1L, "MYSQL", "sales", "orders", null, null),
                new TransferEndpointConfig(2L, "MYSQL", "warehouse", "dwd_orders", null, TransferWriteMode.APPEND),
                List.of(new TransferFieldMapping("order_id", TransferMappingKind.SOURCE_FIELD, "id", null)),
                List.of());
        return new TransferRenderRequest(4L, config.source(), config.target(), config.fieldMappings(), config.partitions());
    }
}
