package com.wbdata.offline.transfer.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wbdata.offline.transfer.dto.TransferExecutionRequest;
import com.wbdata.offline.transfer.dto.TransferConfig;
import com.wbdata.offline.transfer.dto.TransferEndpointConfig;
import com.wbdata.offline.transfer.dto.TransferFieldMapping;
import com.wbdata.offline.transfer.dto.TransferMappingKind;
import com.wbdata.offline.transfer.dto.TransferRenderRequest;
import com.wbdata.offline.transfer.dto.TransferWriteMode;
import com.wbdata.offline.transfer.service.TransferExecutionRenderService;
import com.wbdata.offline.transfer.service.TransferSqlExecutionService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.http.MediaType;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.ArgumentMatchers.same;
import static org.mockito.ArgumentMatchers.eq;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class InternalTransferControllerTest {

    @Test
    void missingTokenIsRejected() {
        TransferExecutionRenderService renderService = mock(TransferExecutionRenderService.class);
        when(renderService.render(null, request().config(), request().parameters()))
                .thenThrow(new ResponseStatusException(org.springframework.http.HttpStatus.UNAUTHORIZED));
        InternalTransferController controller = new InternalTransferController(renderService, mock(TransferSqlExecutionService.class));

        assertThatThrownBy(() -> controller.render(null, request()))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(exception -> ((ResponseStatusException) exception).getStatusCode())
                .isEqualTo(org.springframework.http.HttpStatus.UNAUTHORIZED);
    }

    @Test
    void wrongTokenIsRejected() {
        TransferExecutionRenderService renderService = mock(TransferExecutionRenderService.class);
        when(renderService.render("wrong", request().config(), request().parameters()))
                .thenThrow(new ResponseStatusException(org.springframework.http.HttpStatus.UNAUTHORIZED));
        InternalTransferController controller = new InternalTransferController(renderService, mock(TransferSqlExecutionService.class));

        assertThatThrownBy(() -> controller.render("wrong", request()))
                .isInstanceOf(ResponseStatusException.class)
                .extracting(exception -> ((ResponseStatusException) exception).getStatusCode())
                .isEqualTo(org.springframework.http.HttpStatus.UNAUTHORIZED);
    }

    @Test
    void validTokenReturnsPlainTextConfig() {
        TransferExecutionRenderService renderService = mock(TransferExecutionRenderService.class);
        when(renderService.render("valid-token", request().config(), request().parameters())).thenReturn("env {}\n");
        InternalTransferController controller = new InternalTransferController(renderService, mock(TransferSqlExecutionService.class));

        var response = controller.render("valid-token", request());

        assertThat(response.getStatusCode()).isEqualTo(org.springframework.http.HttpStatus.OK);
        assertThat(response.getHeaders().getContentType()).isEqualTo(MediaType.TEXT_PLAIN);
        assertThat(response.getBody()).isEqualTo("env {}\n");
    }

    @Test
    void sqlEndpointsForwardTokenAndReturnPhaseResult() {
        TransferSqlExecutionService sqlService = mock(TransferSqlExecutionService.class);
        when(sqlService.executePreSql("valid-token", request().config(), request().parameters())).thenReturn("前置 SQL已执行 1 条\n");
        when(sqlService.executePostSql("valid-token", request().config(), request().parameters())).thenReturn("后置 SQL已执行 2 条\n");
        InternalTransferController controller = new InternalTransferController(mock(TransferExecutionRenderService.class), sqlService);

        assertThat(controller.executePreSql("valid-token", request()).getBody()).isEqualTo("前置 SQL已执行 1 条\n");
        assertThat(controller.executePostSql("valid-token", request()).getBody()).isEqualTo("后置 SQL已执行 2 条\n");
    }

    @Test
    void postSqlFailureIsNotConvertedToSuccess() {
        TransferSqlExecutionService sqlService = mock(TransferSqlExecutionService.class);
        when(sqlService.executePostSql("valid-token", request().config(), request().parameters()))
                .thenThrow(new ResponseStatusException(org.springframework.http.HttpStatus.INTERNAL_SERVER_ERROR,
                        "后置 SQL第 2 条执行失败；数据已写入，未回滚，请手动处理"));
        InternalTransferController controller = new InternalTransferController(mock(TransferExecutionRenderService.class), sqlService);
        assertThatThrownBy(() -> controller.executePostSql("valid-token", request()))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("数据已写入，未回滚");
    }

    @Test
    void forwardsIdenticalConfigAndParameterObjectsForAllThreePhases() {
        TransferExecutionRenderService renderService = mock(TransferExecutionRenderService.class);
        TransferSqlExecutionService sqlService = mock(TransferSqlExecutionService.class);
        InternalTransferController controller = new InternalTransferController(renderService, sqlService);
        TransferExecutionRequest wrapper = request();

        controller.render("token", wrapper);
        controller.executePreSql("token", wrapper);
        controller.executePostSql("token", wrapper);

        verify(renderService).render(eq("token"), same(wrapper.config()), same(wrapper.parameters()));
        verify(sqlService).executePreSql(eq("token"), same(wrapper.config()), same(wrapper.parameters()));
        verify(sqlService).executePostSql(eq("token"), same(wrapper.config()), same(wrapper.parameters()));
    }

    @ParameterizedTest
    @ValueSource(strings = {"render", "pre-sql", "post-sql"})
    void deserializesWrapperAndPreservesInjectionLikeValues(String phase) throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        TransferExecutionRequest wrapper = request();
        String json = mapper.writeValueAsString(wrapper);
        assertThat(mapper.readValue(json, TransferExecutionRequest.class)).isEqualTo(wrapper);
        assertThat(mapper.readTree(json).size()).isEqualTo(2);
        assertThat(mapper.readTree(json).path("config").path("groupId").asLong()).isEqualTo(4L);
        TransferExecutionRenderService renderService = mock(TransferExecutionRenderService.class);
        TransferSqlExecutionService sqlService = mock(TransferSqlExecutionService.class);
        var mvc = MockMvcBuilders.standaloneSetup(new InternalTransferController(renderService, sqlService)).build();

        mvc.perform(post("/api/v1/internal/offline/transfer/" + phase)
                        .header(InternalTransferController.INTERNAL_TOKEN_HEADER, "token")
                        .contentType(MediaType.APPLICATION_JSON).content(json))
                .andExpect(status().isOk());
        switch (phase) {
            case "render" -> verify(renderService).render("token", wrapper.config(), wrapper.parameters());
            case "pre-sql" -> verify(sqlService).executePreSql("token", wrapper.config(), wrapper.parameters());
            case "post-sql" -> verify(sqlService).executePostSql("token", wrapper.config(), wrapper.parameters());
            default -> throw new AssertionError(phase);
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"render", "pre-sql", "post-sql"})
    void rejectsInvalidWrapperAndNestedConfigBeforeCallingServices(String phase) throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        TransferExecutionRenderService renderService = mock(TransferExecutionRenderService.class);
        TransferSqlExecutionService sqlService = mock(TransferSqlExecutionService.class);
        var mvc = MockMvcBuilders.standaloneSetup(new InternalTransferController(renderService, sqlService)).build();
        var valid = mapper.valueToTree(request());
        for (String invalid : List.of(
                "{}",
                "{\"config\":null,\"parameters\":{}}",
                "{\"config\":" + valid.path("config") + ",\"parameters\":null}",
                "{\"config\":" + valid.path("config") + ",\"parameters\":{\"value\":null}}",
                "{\"config\":{},\"parameters\":{}}",
                mapper.writeValueAsString(request().config()))) {
            mvc.perform(post("/api/v1/internal/offline/transfer/" + phase)
                            .contentType(MediaType.APPLICATION_JSON).content(invalid))
                    .andExpect(status().isBadRequest());
        }
        verifyNoInteractions(renderService, sqlService);
    }

    private TransferExecutionRequest request() {
        TransferConfig config = new TransferConfig(
                new TransferEndpointConfig(1L, "MYSQL", "sales", "orders", null, null, null, null),
                new TransferEndpointConfig(2L, "MYSQL", "warehouse", "dwd_orders", null, TransferWriteMode.APPEND, null, null),
                List.of(new TransferFieldMapping("order_id", TransferMappingKind.SOURCE_FIELD, "id", null)),
                List.of());
        return new TransferExecutionRequest(
                new TransferRenderRequest(4L, config.source(), config.target(), config.fieldMappings(), config.partitions()),
                Map.of("value", "O'Reilly\n$(touch injected) ${HOME} 中文 \"quoted\""));
    }
}
