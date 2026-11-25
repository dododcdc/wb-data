package com.wbdata.common;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class GlobalExceptionHandlerTest {

    private MockMvc mockMvc() {
        return MockMvcBuilders.standaloneSetup(new DummyController())
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
    }

    @Test
    void methodNotSupported_returns405WithEnvelope() throws Exception {
        mockMvc().perform(post("/test/only-get"))
                .andExpect(status().isMethodNotAllowed())
                .andExpect(jsonPath("$.code").value(405))
                .andExpect(jsonPath("$.message").value("请求方法不被支持: POST"));
    }

    @Test
    void malformedJsonBody_returns400WithEnvelope() throws Exception {
        mockMvc().perform(post("/test/echo")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{bad json"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(400))
                .andExpect(jsonPath("$.message").value("请求体格式错误"));
    }

    @Test
    void unsupportedContentType_returns415WithEnvelope() throws Exception {
        mockMvc().perform(post("/test/echo")
                        .contentType(MediaType.TEXT_PLAIN)
                        .content("plain text"))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.code").value(415));
    }

    @Test
    void noResourceFound_returns404WithEnvelope() {
        GlobalExceptionHandler handler = new GlobalExceptionHandler();

        var response = handler.handleNoResourceFound(new NoResourceFoundException(HttpMethod.GET, "/api/v1/missing"));

        assertThat(response.getCode()).isEqualTo(HttpStatus.NOT_FOUND.value());
        assertThat(response.getMessage()).isEqualTo("接口不存在: /api/v1/missing");
    }

    @Test
    void noHandlerFound_returns404WithEnvelope() {
        GlobalExceptionHandler handler = new GlobalExceptionHandler();

        var response = handler.handleNoHandlerFound(
                new NoHandlerFoundException("GET", "http://localhost/api/v1/missing", HttpHeaders.EMPTY));

        assertThat(response.getCode()).isEqualTo(HttpStatus.NOT_FOUND.value());
        assertThat(response.getMessage()).isEqualTo("接口不存在: http://localhost/api/v1/missing");
    }

    @RestController
    private static class DummyController {
        @GetMapping("/test/only-get")
        String onlyGet() {
            return "ok";
        }

        @PostMapping(value = "/test/echo", consumes = MediaType.APPLICATION_JSON_VALUE)
        String echo(@RequestBody Map<String, Object> body) {
            return body.toString();
        }
    }
}
