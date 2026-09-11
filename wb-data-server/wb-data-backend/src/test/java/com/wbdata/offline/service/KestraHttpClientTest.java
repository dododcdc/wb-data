package com.wbdata.offline.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wbdata.offline.config.OfflineKestraProperties;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.web.server.ResponseStatusException;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpHeaders;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Flow;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

class KestraHttpClientTest {

    @Test
    void createExecutionSendsUtf8InputsAsMultipartFields() throws Exception {
        HttpClient httpClient = Mockito.mock(HttpClient.class);
        ArgumentCaptor<HttpRequest> requestCaptor = ArgumentCaptor.forClass(HttpRequest.class);
        when(httpClient.send(requestCaptor.capture(), any(HttpResponse.BodyHandler.class)))
                .thenReturn(response(200, """
                        {
                          "id": "exec-1",
                          "namespace": "demo",
                          "flowId": "daily",
                          "state": {"current": "CREATED"},
                          "inputs": {"name": "李雷", "note": "a&b=1"}
                        }
                        """));
        KestraHttpClient client = new KestraHttpClient(properties(), new ObjectMapper(), httpClient);

        KestraExecutionSnapshot execution = client.createExecution(
                "demo",
                "daily",
                Map.of("name", "李雷\n第二行", "note", "a&b=1"),
                Map.of("wbdataParameterOverrideKeys", "name---note"));

        HttpRequest request = requestCaptor.getValue();
        String contentType = request.headers().firstValue("Content-Type").orElseThrow();
        String boundary = contentType.substring(contentType.indexOf("boundary=") + "boundary=".length());
        String body = new String(readBody(request), java.nio.charset.StandardCharsets.UTF_8);
        assertThat(request.uri()).isEqualTo(
                URI.create("http://localhost:8090/api/v1/main/executions/demo/daily"
                        + "?labels=wbdataParameterOverrideKeys%3Aname---note"));
        assertThat(body)
                .contains("--" + boundary)
                .contains("name=\"name\"")
                .contains("李雷\n第二行")
                .contains("name=\"note\"")
                .contains("a&b=1")
                .endsWith("--" + boundary + "--\r\n");
        assertThat(execution.inputs()).containsEntry("name", "李雷");
    }

    @Test
    void createExecutionPreservesKestraFailureStatusAndMessage() throws Exception {
        HttpClient httpClient = Mockito.mock(HttpClient.class);
        when(httpClient.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class)))
                .thenReturn(response(422, "invalid input count"));
        KestraHttpClient client = new KestraHttpClient(properties(), new ObjectMapper(), httpClient);

        assertThatThrownBy(() -> client.createExecution("demo", "daily", Map.of("count", "bad")))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(error -> assertThat(((ResponseStatusException) error).getStatusCode().value())
                        .isEqualTo(422))
                .hasMessageContaining("invalid input count");
    }

    @Test
    void validateFlow_postsYamlToKestraValidateEndpoint() throws Exception {
        HttpClient httpClient = Mockito.mock(HttpClient.class);
        ArgumentCaptor<HttpRequest> requestCaptor = ArgumentCaptor.forClass(HttpRequest.class);
        when(httpClient.send(requestCaptor.capture(), any(HttpResponse.BodyHandler.class)))
                .thenReturn(response(200, """
                        [
                          {"constraints": null},
                          {"constraints": "Invalid cron"}
                        ]
                        """));
        KestraHttpClient client = new KestraHttpClient(properties(), new ObjectMapper(), httpClient);

        List<String> violations = client.validateFlow("id: demo\nnamespace: ns\n");

        HttpRequest request = requestCaptor.getValue();
        assertThat(request.method()).isEqualTo("POST");
        assertThat(request.uri()).isEqualTo(URI.create("http://localhost:8090/api/v1/main/flows/validate"));
        assertThat(request.headers().firstValue("Content-Type")).contains("application/x-yaml");
        assertThat(violations).containsExactly("Invalid cron");
    }

    @Test
    void deleteFlow_deletesNamespaceFlowAndIgnoresMissingFlow() throws Exception {
        HttpClient httpClient = Mockito.mock(HttpClient.class);
        ArgumentCaptor<HttpRequest> requestCaptor = ArgumentCaptor.forClass(HttpRequest.class);
        when(httpClient.send(requestCaptor.capture(), any(HttpResponse.BodyHandler.class)))
                .thenReturn(response(404, ""));
        KestraHttpClient client = new KestraHttpClient(properties(), new ObjectMapper(), httpClient);

        client.deleteFlow("system", "sync-flows-g4-main");

        HttpRequest request = requestCaptor.getValue();
        assertThat(request.method()).isEqualTo("DELETE");
        assertThat(request.uri()).isEqualTo(URI.create("http://localhost:8090/api/v1/main/flows/system/sync-flows-g4-main"));
    }

    @Test
    void supportsTaskType_mapsDockerPluginToDockerTaskRunner() throws Exception {
        HttpClient httpClient = Mockito.mock(HttpClient.class);
        when(httpClient.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class)))
                .thenReturn(response(200, """
                        [
                          {
                            "name": "plugin-docker",
                            "group": "io.kestra.plugin.docker",
                            "tasks": [
                              {"cls": "io.kestra.plugin.docker.Run"}
                            ],
                            "taskRunners": []
                          }
                        ]
                        """));
        KestraHttpClient client = new KestraHttpClient(properties(), new ObjectMapper(), httpClient);

        assertThat(client.supportsTaskType("io.kestra.plugin.scripts.runner.docker.Docker")).isTrue();
    }

    @Test
    void supportsTaskType_readsTaskRunnerClassesWhenKestraExposesThem() throws Exception {
        HttpClient httpClient = Mockito.mock(HttpClient.class);
        when(httpClient.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class)))
                .thenReturn(response(200, """
                        [
                          {
                            "name": "plugin-script-shell",
                            "tasks": [],
                            "taskRunners": [
                              {"cls": "io.kestra.plugin.scripts.runner.docker.Docker"}
                            ]
                          }
                        ]
                        """));
        KestraHttpClient client = new KestraHttpClient(properties(), new ObjectMapper(), httpClient);

        assertThat(client.supportsTaskType("io.kestra.plugin.scripts.runner.docker.Docker")).isTrue();
    }

    private OfflineKestraProperties properties() {
        OfflineKestraProperties properties = new OfflineKestraProperties();
        properties.setBaseUrl("http://localhost:8090");
        properties.setTenant("main");
        properties.setUsername("admin@kestra.io");
        properties.setPassword("Admin1234!");
        return properties;
    }

    private HttpResponse<byte[]> response(int status, String body) {
        return new HttpResponse<>() {
            @Override
            public int statusCode() {
                return status;
            }

            @Override
            public HttpRequest request() {
                return null;
            }

            @Override
            public Optional<HttpResponse<byte[]>> previousResponse() {
                return Optional.empty();
            }

            @Override
            public HttpHeaders headers() {
                return HttpHeaders.of(java.util.Map.of(), (name, value) -> true);
            }

            @Override
            public byte[] body() {
                return body.getBytes(java.nio.charset.StandardCharsets.UTF_8);
            }

            @Override
            public Optional<javax.net.ssl.SSLSession> sslSession() {
                return Optional.empty();
            }

            @Override
            public URI uri() {
                return null;
            }

            @Override
            public HttpClient.Version version() {
                return HttpClient.Version.HTTP_1_1;
            }
        };
    }

    private byte[] readBody(HttpRequest request) {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        CompletableFuture<byte[]> completed = new CompletableFuture<>();
        request.bodyPublisher().orElseThrow().subscribe(new Flow.Subscriber<>() {
            @Override
            public void onSubscribe(Flow.Subscription subscription) {
                subscription.request(Long.MAX_VALUE);
            }

            @Override
            public void onNext(ByteBuffer item) {
                byte[] chunk = new byte[item.remaining()];
                item.get(chunk);
                output.writeBytes(chunk);
            }

            @Override
            public void onError(Throwable throwable) {
                completed.completeExceptionally(throwable);
            }

            @Override
            public void onComplete() {
                completed.complete(output.toByteArray());
            }
        });
        return completed.join();
    }
}
