package io.wbdata.kestra.core;

import com.sun.net.httpserver.HttpServer;
import io.kestra.core.models.property.Property;
import io.kestra.core.models.tasks.common.EncryptedString;
import io.kestra.core.runners.RunContext;
import io.kestra.core.runners.RunContextProperty;
import io.wbdata.kestra.internal.WbDataInternalClient;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ResolveGitCredentialsTest {

    private HttpServer server;
    private String baseUrl;
    private WbDataInternalClient internalClient;

    @BeforeEach
    void setUp() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
        internalClient = new WbDataInternalClient(HttpClient.newHttpClient(), key -> null);
    }

    @AfterEach
    void tearDown() {
        server.stop(0);
    }

    @Test
    void run_fetchesGitCredentialsAndEncryptsTokenOutput() throws Exception {
        AtomicReference<String> receivedBody = new AtomicReference<>();
        server.createContext("/api/v1/internal/offline/credentials/git", exchange -> {
            receivedBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] resp = """
                    {"groupId":4,"provider":"github","repositoryUrl":"https://github.com/alice/wb-data-4.git","username":"alice","token":"ghp_plain_pat"}
                    """.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, resp.length);
            exchange.getResponseBody().write(resp);
            exchange.close();
        });

        ResolveGitCredentials task = new ResolveGitCredentials() {
            @Override
            protected WbDataInternalClient internalClient() {
                return internalClient;
            }
        };
        setField(task, "groupId", Property.ofValue(4L));
        setField(task, "internalBaseUrl", Property.ofValue(baseUrl));
        setField(task, "internalToken", Property.ofValue("tok"));

        RunContext rc = mockRunContext("enc(ghp_plain_pat)");
        ResolveGitCredentials.GitCredentialsOutput output = task.run(rc);

        assertThat(receivedBody.get()).isEqualTo("{\"groupId\":4}");
        assertThat(output.getRepositoryUrl()).isEqualTo("https://github.com/alice/wb-data-4.git");
        assertThat(output.getUsername()).isEqualTo("alice");
        assertThat(output.getToken()).isNotNull();
        assertThat(output.getToken().getType()).isEqualTo(EncryptedString.TYPE);
        assertThat(output.getToken().getValue()).isEqualTo("enc(ghp_plain_pat)");
    }

    private void setField(Object target, String name, Object value) throws Exception {
        var field = ResolveGitCredentials.class.getDeclaredField(name);
        field.setAccessible(true);
        field.set(target, value);
    }

    @SuppressWarnings("unchecked")
    private RunContext mockRunContext(String encryptedValue) throws Exception {
        RunContext rc = mock(RunContext.class);
        when(rc.encrypt("ghp_plain_pat")).thenReturn(encryptedValue);
        lenient().when(rc.pluginConfiguration(any())).thenReturn(Optional.empty());
        lenient().when(rc.render(any(String.class), anyMap())).thenAnswer(inv -> inv.getArgument(0));
        lenient().when(rc.render(nullable(Property.class))).thenAnswer(inv -> {
            Property<Object> prop = inv.getArgument(0);
            RunContextProperty<Object> rcp = mock(RunContextProperty.class);
            lenient().when(rcp.as(any())).thenAnswer(i -> prop == null
                    ? Optional.empty()
                    : Optional.ofNullable(Property.as(prop, rc, i.getArgument(0))));
            return rcp;
        });
        return rc;
    }
}
