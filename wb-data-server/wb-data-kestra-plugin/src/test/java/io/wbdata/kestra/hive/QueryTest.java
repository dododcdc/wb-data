package io.wbdata.kestra.hive;

import com.sun.net.httpserver.HttpServer;
import io.kestra.core.models.property.Property;
import io.kestra.core.models.tasks.runners.TaskCommands;
import io.kestra.core.models.tasks.runners.TaskRunner;
import io.kestra.core.models.tasks.runners.TaskRunnerDetailResult;
import io.kestra.core.models.tasks.runners.TaskRunnerResult;
import io.kestra.core.runners.LocalWorkingDir;
import io.kestra.core.runners.RunContext;
import io.kestra.core.runners.RunContextProperty;
import io.wbdata.kestra.internal.WbDataInternalClient;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;

class QueryTest {

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
    void run_passesPasswordViaMode0600FileAndBeelineMinusWWithoutMinusP() throws Exception {
        LocalWorkingDir workingDir = new LocalWorkingDir(Files.createDirectories(tempDir.resolve("work-pw")));
        workingDir.createFile("scripts/demo/hive_1.hql", "SELECT 1;\n".getBytes(StandardCharsets.UTF_8));

        Path captureDir = Files.createDirectories(tempDir.resolve("capture-pw"));
        Path fakeBeeline = createFakeBeeline(captureDir);

        String complexPassword = "p'ss$1{{raw}}";
        server.createContext("/api/v1/internal/offline/credentials/datasource", exchange -> {
            String payload = "{\"dataSourceId\":2,\"type\":\"HIVE\",\"url\":\"jdbc:hive2://omarchy.local:10000/dw\","
                    + "\"username\":\"hive\",\"password\":\"p'ss$1{{raw}}\"}";
            byte[] resp = payload.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, resp.length);
            exchange.getResponseBody().write(resp);
            exchange.close();
        });

        Map<String, String> conf = new LinkedHashMap<>();
        conf.put("hive.exec.dynamic.partition.mode", "nonstrict");
        conf.put("mapred.job.name", "daily's job; part=1");

        Query task = new Query() {
            @Override
            protected WbDataInternalClient internalClient() {
                return internalClient;
            }
        };
        setTaskFields(task, "hive_1", 2L, 4L, "scripts/demo/hive_1.hql", conf, null, fakeBeeline.toString());

        Query.HiveQueryOutput output = task.run(mockRunContext(workingDir));

        assertThat(output.getExitCode()).isZero();
        List<String> args = Files.readAllLines(captureDir.resolve("args.txt"), StandardCharsets.UTF_8);
        assertThat(args).doesNotContain("-p", complexPassword);
        assertThat(args).containsSubsequence("-u", "jdbc:hive2://omarchy.local:10000/dw", "-n", "hive", "-w");
        assertThat(args).containsSequence("--hiveconf", "hive.exec.dynamic.partition.mode=nonstrict");
        assertThat(args).containsSequence("--hiveconf", "mapred.job.name=daily's job; part=1");
        assertThat(args.subList(args.size() - 2, args.size())).containsExactly("-f", "scripts/demo/hive_1.hql");

        assertThat(Files.readString(captureDir.resolve("pw_content.txt"), StandardCharsets.UTF_8))
                .isEqualTo(complexPassword);
        assertThat(Files.readString(captureDir.resolve("pw_mode.txt"), StandardCharsets.UTF_8).trim())
                .isEqualTo("600");
        assertThat(workingDir.path().resolve(".wb-data-beeline.pw")).doesNotExist();
    }

    @Test
    void run_omitsMinusWWhenHivePasswordIsEmptyAndRendersParameterizedScripts() throws Exception {
        LocalWorkingDir workingDir = new LocalWorkingDir(Files.createDirectories(tempDir.resolve("work-nopw")));
        workingDir.createFile("scripts/demo/hive_param.hql", "SELECT '${v_day}';".getBytes(StandardCharsets.UTF_8));

        Path captureDir = Files.createDirectories(tempDir.resolve("capture-nopw"));
        Path fakeBeeline = createFakeBeeline(captureDir);

        AtomicReference<String> renderRequestBody = new AtomicReference<>();
        server.createContext("/api/v1/internal/offline/credentials/datasource", exchange -> {
            byte[] resp = """
                    {"dataSourceId":2,"type":"HIVE","url":"jdbc:hive2://omarchy.local:10000/default","username":"hive","password":""}
                    """.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, resp.length);
            exchange.getResponseBody().write(resp);
            exchange.close();
        });
        server.createContext("/api/v1/internal/offline/script/render", exchange -> {
            renderRequestBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] resp = "SELECT '20261122';".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, resp.length);
            exchange.getResponseBody().write(resp);
            exchange.close();
        });

        Query task = new Query() {
            @Override
            protected WbDataInternalClient internalClient() {
                return internalClient;
            }
        };
        setTaskFields(task, "hive_param", 2L, 4L, "scripts/demo/hive_param.hql",
                Map.of(), Map.of("v_day", "20261122"), fakeBeeline.toString());

        Query.HiveQueryOutput output = task.run(mockRunContext(workingDir));

        assertThat(output.getExitCode()).isZero();
        assertThat(renderRequestBody.get()).contains("\"kind\":\"HIVE_SQL\"", "\"v_day\":\"20261122\"");
        List<String> args = Files.readAllLines(captureDir.resolve("args.txt"), StandardCharsets.UTF_8);
        assertThat(args).doesNotContain("-w", "-p");
        assertThat(args).containsExactly(
                "-u", "jdbc:hive2://omarchy.local:10000/default",
                "-n", "hive",
                "-f", ".wb-data-script/hive_param.hql"
        );
        assertThat(Files.readString(workingDir.path().resolve(".wb-data-script/hive_param.hql"), StandardCharsets.UTF_8))
                .isEqualTo("SELECT '20261122';");
        assertThat(workingDir.path().resolve(".wb-data-beeline.pw")).doesNotExist();
    }

    @Test
    void run_hiveTaskCommandsExposeSeparateOutputDirectorySoWorkingFilesAreIncluded() throws Exception {
        LocalWorkingDir workingDir = new LocalWorkingDir(Files.createDirectories(tempDir.resolve("work-docker")));
        workingDir.createFile("scripts/demo/hive_1.hql", "SELECT 1;\n".getBytes(StandardCharsets.UTF_8));

        server.createContext("/api/v1/internal/offline/credentials/datasource", exchange -> {
            String payload = "{\"dataSourceId\":2,\"type\":\"HIVE\",\"url\":\"jdbc:hive2://omarchy.local:10000/dw\","
                    + "\"username\":\"hive\",\"password\":\"secret\"}";
            byte[] resp = payload.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, resp.length);
            exchange.getResponseBody().write(resp);
            exchange.close();
        });

        AtomicReference<List<Path>> capturedRelativeFiles = new AtomicReference<>();
        AtomicReference<String> capturedOutputDirName = new AtomicReference<>();
        TaskRunner<TaskRunnerDetailResult> capturingRunner = new TaskRunner<>() {
            @Override
            public TaskRunnerResult<TaskRunnerDetailResult> run(RunContext runContext,
                                                                TaskCommands taskCommands,
                                                                List<String> filesToSend) throws Exception {
                capturedRelativeFiles.set(taskCommands.relativeWorkingDirectoryFilesPaths());
                capturedOutputDirName.set(taskCommands.outputDirectoryName());
                return new TaskRunnerResult<>(0, taskCommands.getLogConsumer());
            }
        };

        Query task = new Query() {
            @Override
            protected WbDataInternalClient internalClient() {
                return internalClient;
            }
        };
        setTaskFields(task, "hive_docker", 2L, 4L, "scripts/demo/hive_1.hql", null, null, "beeline");
        setField(Query.class, task, "taskRunner", capturingRunner);

        Query.HiveQueryOutput output = task.run(mockRunContext(workingDir));

        assertThat(output.getExitCode()).isZero();
        assertThat(capturedOutputDirName.get()).isEqualTo(".wb-data-output");
        assertThat(capturedRelativeFiles.get())
                .contains(Path.of("scripts/demo/hive_1.hql"), Path.of(".wb-data-beeline.pw"));
        assertThat(workingDir.path().resolve(".wb-data-beeline.pw")).doesNotExist();
    }

    private Path createFakeBeeline(Path captureDir) throws IOException {
        Path script = captureDir.resolve("beeline");
        Files.writeString(script, """
                #!/bin/sh
                set -eu
                CAPTURE=%s
                : > "$CAPTURE/args.txt"
                prev=""
                for arg in "$@"; do
                  printf '%%s\\n' "$arg" >> "$CAPTURE/args.txt"
                  if [ "$prev" = "-w" ]; then
                    cat "$arg" > "$CAPTURE/pw_content.txt"
                    { stat -f '%%Lp' "$arg" 2>/dev/null || stat -c '%%a' "$arg"; } > "$CAPTURE/pw_mode.txt"
                  fi
                  prev="$arg"
                done
                """.formatted(shellQuote(captureDir.toString())), StandardCharsets.UTF_8);
        assertThat(script.toFile().setExecutable(true)).isTrue();
        return script;
    }

    private String shellQuote(String value) {
        return "'" + value.replace("'", "'\"'\"'") + "'";
    }

    private void setTaskFields(Query task,
                               String id,
                               Long dsId,
                               Long groupId,
                               String scriptPath,
                               Map<String, String> hiveConf,
                               Map<String, Object> parameters,
                               String beelineBinary) throws Exception {
        setField(io.kestra.core.models.tasks.Task.class, task, "id", id);
        setField(Query.class, task, "dataSourceId", Property.ofValue(dsId));
        setField(Query.class, task, "groupId", Property.ofValue(groupId));
        setField(Query.class, task, "internalBaseUrl", Property.ofValue(baseUrl));
        setField(Query.class, task, "internalToken", Property.ofValue("tok"));
        setField(Query.class, task, "scriptPath", Property.ofValue(scriptPath));
        if (hiveConf != null && !hiveConf.isEmpty()) {
            setField(Query.class, task, "hiveConf", Property.ofValue(hiveConf));
        }
        if (parameters != null && !parameters.isEmpty()) {
            setField(Query.class, task, "parameters", Property.ofValue(parameters));
        }
        setField(Query.class, task, "beelineBinary", Property.ofValue(beelineBinary));
    }

    private void setField(Class<?> owner, Object target, String name, Object value) throws Exception {
        var field = owner.getDeclaredField(name);
        field.setAccessible(true);
        field.set(target, value);
    }

    @SuppressWarnings("unchecked")
    private RunContext mockRunContext(LocalWorkingDir localWorkingDir) {
        RunContext rc = mock(RunContext.class);
        lenient().when(rc.workingDir()).thenReturn(localWorkingDir);
        lenient().when(rc.logger()).thenReturn(LoggerFactory.getLogger(QueryTest.class));
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
                        ? List.of()
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
