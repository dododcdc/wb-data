package com.wbdata.offline.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wbdata.offline.config.OfflineKestraProperties;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpHeaders;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

class KestraHttpClientTest {

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
}
