package io.wbdata.kestra.jdbc;

import com.sun.net.httpserver.HttpServer;
import io.kestra.core.models.property.Property;
import io.kestra.core.runners.LocalWorkingDir;
import io.kestra.core.runners.RunContext;
import io.kestra.core.runners.RunContextProperty;
import io.wbdata.kestra.internal.WbDataInternalClient;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Map;
import java.util.Optional;
import java.util.Properties;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;

class JdbcQueryCredentialResolutionTest {

    @TempDir
    Path tempDir;

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
    void deferredUrlAndRuntimeResolution_workForMysqlPostgresqlAndClickhouse() throws Exception {
        server.createContext("/api/v1/internal/offline/credentials/datasource", exchange -> {
            String req = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            String json;
            if (req.contains("\"MYSQL\"")) {
                json = """
                        {"dataSourceId":1,"type":"MYSQL","url":"jdbc:mysql://omarchy.local:3306/dw","username":"u_mysql","password":"p@ss{{secret}}"}
                        """;
            } else if (req.contains("\"POSTGRESQL\"")) {
                json = """
                        {"dataSourceId":2,"type":"POSTGRESQL","url":"jdbc:postgresql://omarchy.local:5432/analytics","username":"u_pg","password":"pg{{pw}}"}
                        """;
            } else {
                json = """
                        {"dataSourceId":3,"type":"CLICKHOUSE","url":"jdbc:clickhouse://omarchy.local:8123/default","username":"u_ck","password":"ck{{pw}}"}
                        """;
            }
            byte[] resp = json.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, resp.length);
            exchange.getResponseBody().write(resp);
            exchange.close();
        });

        RunContext rc = mockRunContext();

        var mysqlWithoutUrlOrDs = io.wbdata.kestra.jdbc.mysql.Query.builder()
                .id("m0").type(io.wbdata.kestra.jdbc.mysql.Query.class.getName())
                .sql(Property.ofValue("select 1")).build();
        assertThat(mysqlWithoutUrlOrDs.getUrl()).isNull();

        var mysql = new io.wbdata.kestra.jdbc.mysql.Query() {
            @Override
            protected WbDataInternalClient internalClient() {
                return internalClient;
            }
        };
        setField(mysql, "dataSourceId", Property.ofValue(1L));
        setField(mysql, "groupId", Property.ofValue(4L));
        setField(mysql, "internalBaseUrl", Property.ofValue(baseUrl));
        setField(mysql, "internalToken", Property.ofValue("tok"));
        assertThat(mysql.getUrl()).isEqualTo(Property.ofValue("jdbc:mysql://wbdata-deferred"));

        Properties mysqlProps = mysql.connectionProperties(rc);
        assertThat(mysqlProps.getProperty("jdbc.url")).startsWith("jdbc:mysql://omarchy.local:3306/dw");
        assertThat(mysqlProps.getProperty("jdbc.url")).contains("useCursorFetch=true");
        assertThat(mysqlProps.getProperty("user")).isEqualTo("u_mysql");
        assertThat(mysqlProps.getProperty("password")).isEqualTo("p@ss{{secret}}");

        var pg = new io.wbdata.kestra.jdbc.postgresql.Query() {
            @Override
            protected WbDataInternalClient internalClient() {
                return internalClient;
            }
        };
        setField(pg, "dataSourceId", Property.ofValue(2L));
        setField(pg, "groupId", Property.ofValue(4L));
        setField(pg, "internalBaseUrl", Property.ofValue(baseUrl));
        setField(pg, "internalToken", Property.ofValue("tok"));
        assertThat(pg.getUrl()).isEqualTo(Property.ofValue("jdbc:postgresql://wbdata-deferred"));

        Properties pgProps = pg.connectionProperties(rc);
        assertThat(pgProps.getProperty("jdbc.url")).isEqualTo("jdbc:postgresql://omarchy.local:5432/analytics");
        assertThat(pgProps.getProperty("user")).isEqualTo("u_pg");
        assertThat(pgProps.getProperty("password")).isEqualTo("pg{{pw}}");

        var ck = new io.wbdata.kestra.jdbc.clickhouse.Query() {
            @Override
            protected WbDataInternalClient internalClient() {
                return internalClient;
            }
        };
        setField(ck, "dataSourceId", Property.ofValue(3L));
        setField(ck, "groupId", Property.ofValue(4L));
        setField(ck, "internalBaseUrl", Property.ofValue(baseUrl));
        setField(ck, "internalToken", Property.ofValue("tok"));
        assertThat(ck.getUrl()).isEqualTo(Property.ofValue("jdbc:clickhouse://wbdata-deferred"));

        Properties ckProps = ck.connectionProperties(rc);
        assertThat(ckProps.getProperty("jdbc.url")).isEqualTo("jdbc:clickhouse://omarchy.local:8123/default");
        assertThat(ckProps.getProperty("user")).isEqualTo("u_ck");
        assertThat(ckProps.getProperty("password")).isEqualTo("ck{{pw}}");
    }

    @Test
    void legacyInlineUrlUsernamePassword_remainsCompatibleWhenDataSourceIdAbsent() throws Exception {
        RunContext rc = mockRunContext();
        var mysql = io.wbdata.kestra.jdbc.mysql.Query.builder()
                .id("legacy")
                .type(io.wbdata.kestra.jdbc.mysql.Query.class.getName())
                .url(Property.ofValue("jdbc:mysql://legacy.example:3306/app"))
                .username(Property.ofValue("legacy_user"))
                .password(Property.ofValue("legacy_pass"))
                .sql(Property.ofValue("select 1"))
                .build();

        assertThat(mysql.getUrl()).isEqualTo(Property.ofValue("jdbc:mysql://legacy.example:3306/app"));
        Properties props = mysql.connectionProperties(rc);
        assertThat(props.getProperty("jdbc.url")).startsWith("jdbc:mysql://legacy.example:3306/app");
        assertThat(props.getProperty("user")).isEqualTo("legacy_user");
        assertThat(props.getProperty("password")).isEqualTo("legacy_pass");
    }

    private void setField(Object target, String name, Object value) throws Exception {
        var field = target.getClass().getSuperclass().getDeclaredField(name);
        field.setAccessible(true);
        field.set(target, value);
    }

    @SuppressWarnings("unchecked")
    private RunContext mockRunContext() {
        RunContext rc = mock(RunContext.class);
        LocalWorkingDir workingDir = new LocalWorkingDir(tempDir);
        lenient().when(rc.workingDir()).thenReturn(workingDir);
        lenient().when(rc.pluginConfiguration(any())).thenReturn(Optional.empty());
        try {
            lenient().when(rc.render(any(String.class), anyMap())).thenAnswer(inv -> inv.getArgument(0));
            lenient().when(rc.render(nullable(Property.class))).thenAnswer(inv -> {
                Property<Object> prop = inv.getArgument(0);
                RunContextProperty<Object> rcp = mock(RunContextProperty.class);
                lenient().when(rcp.as(any())).thenAnswer(i -> prop == null
                        ? Optional.empty()
                        : Optional.ofNullable(Property.as(prop, rc, i.getArgument(0))));
                lenient().when(rcp.asList(any())).thenAnswer(i -> prop == null
                        ? java.util.List.of()
                        : Property.asList(prop, rc, i.getArgument(0)));
                lenient().when(rcp.asMap(any(), any())).thenAnswer(i -> prop == null
                        ? Map.of()
                        : Property.asMap(prop, rc, i.getArgument(0), i.getArgument(1)));
                return rcp;
            });
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
        return rc;
    }
}
