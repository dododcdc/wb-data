package io.wbdata.kestra.internal;

import com.sun.net.httpserver.HttpServer;
import io.kestra.core.models.property.Property;
import io.kestra.core.runners.RunContext;
import io.kestra.core.runners.RunContextProperty;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class WbDataInternalClientTest {

    private HttpServer server;
    private String baseUrl;

    @BeforeEach
    void setUp() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    @AfterEach
    void tearDown() {
        server.stop(0);
    }

    @Test
    void resolveDataSource_resolveGit_andRenderScript_happyPathsAndTrailingSlash() throws Exception {
        AtomicReference<String> capturedHeader = new AtomicReference<>();
        AtomicReference<String> capturedBody = new AtomicReference<>();

        server.createContext("/api/v1/internal/offline/credentials/datasource", exchange -> {
            capturedHeader.set(exchange.getRequestHeaders().getFirst(WbDataInternalClient.INTERNAL_TOKEN_HEADER));
            capturedBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] resp = """
                    {"dataSourceId":11,"type":"MYSQL","url":"jdbc:mysql://db.example:3306/dw","username":"analyst","password":"p{{1}}"}
                    """.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, resp.length);
            exchange.getResponseBody().write(resp);
            exchange.close();
        });
        server.createContext("/api/v1/internal/offline/credentials/git", exchange -> {
            byte[] resp = """
                    {"groupId":4,"provider":"github","repositoryUrl":"https://github.com/alice/wb-data-4.git","username":"alice","token":"ghp_123"}
                    """.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, resp.length);
            exchange.getResponseBody().write(resp);
            exchange.close();
        });
        server.createContext("/api/v1/internal/offline/script/render", exchange -> {
            byte[] resp = "SELECT '20261122';".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, resp.length);
            exchange.getResponseBody().write(resp);
            exchange.close();
        });

        WbDataInternalClient client = new WbDataInternalClient(HttpClient.newHttpClient(), key -> null);
        RunContext rc = mockRunContext();

        WbDataInternalClient.DataSourceCredentials ds = client.resolveDataSource(
                rc, Property.ofValue(baseUrl + "///"), Property.ofValue("tok-1"), 4L, 11L, "MYSQL");
        assertThat(capturedHeader.get()).isEqualTo("tok-1");
        assertThat(capturedBody.get()).contains("\"groupId\":4", "\"dataSourceId\":11", "\"expectedType\":\"MYSQL\"");
        assertThat(ds.url()).isEqualTo("jdbc:mysql://db.example:3306/dw");
        assertThat(ds.password()).isEqualTo("p{{1}}");

        WbDataInternalClient.GitCredentials git = client.resolveGit(
                rc, Property.ofValue(baseUrl), Property.ofValue("tok-1"), 4L);
        assertThat(git.repositoryUrl()).isEqualTo("https://github.com/alice/wb-data-4.git");
        assertThat(git.token()).isEqualTo("ghp_123");

        String rendered = client.renderScript(
                rc, Property.ofValue(baseUrl), Property.ofValue("tok-1"),
                "HIVE_SQL", "SELECT '${day}';", Map.of("day", "20261122"));
        assertThat(rendered).isEqualTo("SELECT '20261122';");
    }

    @Test
    void configurationResolution_prefersTaskPropertyOverPluginConfigOverEnv() throws Exception {
        Map<String, String> env = Map.of(
                WbDataInternalClient.DEFAULT_BASE_URL_ENV, "http://env.example:8080/",
                WbDataInternalClient.DEFAULT_TOKEN_ENV, "env-token"
        );
        WbDataInternalClient client = new WbDataInternalClient(HttpClient.newHttpClient(), env::get);
        RunContext rc = mockRunContext();
        when(rc.pluginConfiguration("internalBaseUrl")).thenReturn(Optional.of("http://plugin.example:8080/"));
        when(rc.pluginConfiguration("internalToken")).thenReturn(Optional.of("plugin-token"));

        assertThat(client.resolveBaseUrl(rc, Property.ofValue("http://task.example:8080/"))).isEqualTo("http://task.example:8080");
        assertThat(client.resolveToken(rc, Property.ofValue("task-token"))).isEqualTo("task-token");

        assertThat(client.resolveBaseUrl(rc, null)).isEqualTo("http://plugin.example:8080");
        assertThat(client.resolveToken(rc, null)).isEqualTo("plugin-token");

        when(rc.pluginConfiguration("internalBaseUrl")).thenReturn(Optional.empty());
        when(rc.pluginConfiguration("internalToken")).thenReturn(Optional.empty());
        assertThat(client.resolveBaseUrl(rc, null)).isEqualTo("http://env.example:8080");
        assertThat(client.resolveToken(rc, null)).isEqualTo("env-token");

        WbDataInternalClient emptyClient = new WbDataInternalClient(HttpClient.newHttpClient(), k -> null);
        assertThatThrownBy(() -> emptyClient.resolveBaseUrl(rc, null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("internalBaseUrl");
        assertThatThrownBy(() -> emptyClient.resolveToken(rc, null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("internalToken");
    }

    @Test
    void non2xxResponse_throwsAndRedactsInternalToken() {
        String secretToken = "super-secret-internal-token";
        server.createContext("/api/v1/internal/offline/credentials/datasource", exchange -> {
            byte[] resp = ("{\"message\":\"bad token: " + secretToken + "\"}").getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(401, resp.length);
            exchange.getResponseBody().write(resp);
            exchange.close();
        });

        WbDataInternalClient client = new WbDataInternalClient(HttpClient.newHttpClient(), key -> null);
        RunContext rc = mockRunContext();

        assertThatThrownBy(() -> client.resolveDataSource(
                rc, Property.ofValue(baseUrl), Property.ofValue(secretToken), 4L, 11L, "MYSQL"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("401")
                .hasMessageNotContaining(secretToken);
    }

    @SuppressWarnings("unchecked")
    private RunContext mockRunContext() {
        RunContext rc = mock(RunContext.class);
        lenient().when(rc.pluginConfiguration(any())).thenReturn(Optional.empty());
        try {
            lenient().when(rc.render(any(String.class), anyMap())).thenAnswer(inv -> inv.getArgument(0));
            lenient().when(rc.render(nullable(Property.class))).thenAnswer(inv -> {
                Property<Object> prop = inv.getArgument(0);
                RunContextProperty<Object> rcp = mock(RunContextProperty.class);
                lenient().when(rcp.as(any())).thenAnswer(i -> prop == null
                        ? Optional.empty()
                        : Optional.ofNullable(Property.as(prop, rc, i.getArgument(0))));
                return rcp;
            });
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
        return rc;
    }
}
