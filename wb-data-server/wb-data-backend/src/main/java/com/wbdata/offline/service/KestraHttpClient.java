package com.wbdata.offline.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wbdata.offline.config.OfflineKestraProperties;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.util.UriUtils;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URLEncoder;
import java.net.Authenticator;
import java.net.PasswordAuthentication;
import java.net.Proxy;
import java.net.ProxySelector;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
public class KestraHttpClient implements KestraClient {

    private final OfflineKestraProperties properties;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;
    private final OfflineFlowYamlSupport yamlSupport = new OfflineFlowYamlSupport();
    private volatile Set<String> cachedTaskTypes;

    @Autowired
    public KestraHttpClient(OfflineKestraProperties properties, ObjectMapper objectMapper) {
        this(
                properties,
                objectMapper,
                HttpClient.newBuilder()
                        .connectTimeout(Duration.ofSeconds(10))
                        .proxy(new NoProxySelector())
                        .build()
        );
    }

    KestraHttpClient(OfflineKestraProperties properties, ObjectMapper objectMapper, HttpClient httpClient) {
        this.properties = properties;
        this.objectMapper = objectMapper;
        this.httpClient = httpClient;
    }

    @Override
    public void upsertFlow(String source) {
        ensureCredentialsConfigured();
        OfflineFlowYamlSupport.FlowIdentity identity = yamlSupport.parseIdentity(source);
        HttpResponse<byte[]> createResponse = send(
                "POST",
                "/api/v1/" + properties.getTenant() + "/flows",
                source.getBytes(StandardCharsets.UTF_8),
                "application/x-yaml",
                "application/json"
        );
        if (isSuccessful(createResponse.statusCode())) {
            return;
        }
        if (!shouldRetryFlowUpdate(createResponse)) {
            throw toKestraException(createResponse, "创建 Flow 失败");
        }

        HttpResponse<byte[]> updateResponse = send(
                "PUT",
                "/api/v1/" + properties.getTenant() + "/flows/"
                        + encode(identity.namespace()) + "/" + encode(identity.flowId()),
                source.getBytes(StandardCharsets.UTF_8),
                "application/x-yaml",
                "application/json"
        );
        if (!isSuccessful(updateResponse.statusCode())) {
            throw toKestraException(updateResponse, "更新 Flow 失败");
        }
    }

    @Override
    public void upsertNamespaceFile(String namespace, String path, String content) {
        ensureCredentialsConfigured();
        String boundary = "----wb-data-file-" + UUID.randomUUID().toString().replace("-", "");
        byte[] body = buildFileUploadBody(boundary, path, content);
        HttpResponse<byte[]> response = send(
                "POST",
                "/api/v1/" + properties.getTenant() + "/namespaces/" + encode(namespace) + "/files?path=" + encodeQueryParam(path),
                body,
                "multipart/form-data; boundary=" + boundary,
                "application/json"
        );
        if (!isSuccessful(response.statusCode())) {
            throw toKestraException(response, "上传命名空间文件失败");
        }
    }

    @Override
    public KestraExecutionSnapshot createExecution(String namespace, String flowId) {
        ensureCredentialsConfigured();
        String boundary = "----wb-data-" + UUID.randomUUID().toString().replace("-", "");
        byte[] body = ("--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8);
        HttpResponse<byte[]> response = send(
                "POST",
                "/api/v1/" + properties.getTenant() + "/executions/" + encode(namespace) + "/" + encode(flowId),
                body,
                "multipart/form-data; boundary=" + boundary,
                "application/json"
        );
        if (!isSuccessful(response.statusCode())) {
            throw toKestraException(response, "创建执行失败");
        }
        return readExecution(response.body());
    }

    @Override
    public List<KestraExecutionSnapshot> searchExecutions(Map<String, String> filters) {
        ensureCredentialsConfigured();
        List<KestraExecutionSnapshot> executions = new ArrayList<>();
        int page = 1;
        int size = 100;
        while (true) {
            HttpResponse<byte[]> response = send(
                    "GET",
                    buildExecutionSearchPath(filters, page, size),
                    null,
                    null,
                    "application/json"
            );
            if (!isSuccessful(response.statusCode())) {
                throw toKestraException(response, "查询执行列表失败");
            }
            try {
                JsonNode root = objectMapper.readTree(response.body());
                JsonNode results = root.path("results");
                if (!results.isArray() || results.isEmpty()) {
                    break;
                }
                for (JsonNode item : results) {
                    executions.add(readExecution(item));
                }
                int total = root.path("total").asInt(executions.size());
                if (executions.size() >= total || results.size() < size) {
                    break;
                }
                page++;
            } catch (IOException ex) {
                throw new IllegalStateException("解析 Kestra 执行列表失败", ex);
            }
        }
        return executions;
    }

    @Override
    public String getFlowSource(String namespace, String flowId) {
        ensureCredentialsConfigured();
        HttpResponse<byte[]> response = send(
                "GET",
                "/api/v1/" + properties.getTenant() + "/flows/" + encode(namespace) + "/" + encode(flowId) + "?source=true",
                null,
                null,
                "application/json"
        );
        if (!isSuccessful(response.statusCode())) {
            throw toKestraException(response, "查询执行脚本失败");
        }
        try {
            return readText(objectMapper.readTree(response.body()).path("source"));
        } catch (IOException ex) {
            throw new IllegalStateException("解析 Kestra Flow 源码失败", ex);
        }
    }

    @Override
    public KestraExecutionSnapshot getExecution(String executionId) {
        ensureCredentialsConfigured();
        HttpResponse<byte[]> response = send(
                "GET",
                "/api/v1/" + properties.getTenant() + "/executions/" + encode(executionId),
                null,
                null,
                "application/json"
        );
        if (!isSuccessful(response.statusCode())) {
            throw toKestraException(response, "查询执行详情失败");
        }
        return readExecution(response.body());
    }

    @Override
    public List<KestraLogEntry> getLogs(String executionId, String taskId) {
        ensureCredentialsConfigured();
        HttpResponse<byte[]> response = send(
                "GET",
                "/api/v1/" + properties.getTenant() + "/logs/" + encode(executionId),
                null,
                null,
                "application/json"
        );
        if (!isSuccessful(response.statusCode())) {
            throw toKestraException(response, "查询执行日志失败");
        }

        try {
            JsonNode root = objectMapper.readTree(response.body());
            List<KestraLogEntry> entries = new ArrayList<>();
            if (root.isArray()) {
                for (JsonNode item : root) {
                    KestraLogEntry entry = new KestraLogEntry(
                            readInstant(item.path("timestamp"), item.path("date")),
                            readText(item.path("taskId")),
                            readText(item.path("level")),
                            readText(item.path("message"))
                    );
                    if (taskId == null || taskId.equals(entry.taskId())) {
                        entries.add(entry);
                    }
                }
            }
            return entries;
        } catch (IOException ex) {
            throw new IllegalStateException("解析 Kestra 日志失败", ex);
        }
    }

    @Override
    public void killExecution(String executionId) {
        ensureCredentialsConfigured();
        HttpResponse<byte[]> response = send(
                "DELETE",
                "/api/v1/" + properties.getTenant() + "/executions/" + encode(executionId) + "/kill",
                null,
                null,
                "text/json"
        );
        if (!(response.statusCode() == 200 || response.statusCode() == 202 || response.statusCode() == 204)) {
            throw toKestraException(response, "停止执行失败");
        }
    }

    @Override
    public boolean supportsTaskType(String taskType) {
        return getTaskTypes().contains(taskType);
    }

    private KestraExecutionSnapshot readExecution(byte[] payload) {
        try {
            return readExecution(objectMapper.readTree(payload));
        } catch (IOException ex) {
            throw new IllegalStateException("解析 Kestra 执行详情失败", ex);
        }
    }

    private KestraExecutionSnapshot readExecution(JsonNode root) {
        JsonNode state = root.path("state");
        List<KestraTaskRunSnapshot> taskRuns = new ArrayList<>();
        JsonNode taskRunList = root.path("taskRunList");
        if (taskRunList.isArray()) {
            for (JsonNode taskRun : taskRunList) {
                JsonNode taskState = taskRun.path("state");
                taskRuns.add(new KestraTaskRunSnapshot(
                        readText(taskRun.path("taskId")),
                        readText(taskState.path("current")),
                        readInstant(taskState.path("startDate"), taskRun.path("startDate")),
                        readInstant(taskState.path("endDate"), taskRun.path("endDate"))
                ));
            }
        }

        return new KestraExecutionSnapshot(
                readText(root.path("id")),
                readText(root.path("namespace")),
                readText(root.path("flowId")),
                readText(state.path("current")),
                readInstant(state.path("startDate"), firstHistoryDate(state), root.path("createdAt"), root.path("createdDate")),
                readInstant(state.path("startDate"), root.path("startDate")),
                readInstant(state.path("endDate"), root.path("endDate")),
                taskRuns,
                readLabels(root.path("labels"))
        );
    }

    private JsonNode firstHistoryDate(JsonNode state) {
        JsonNode histories = state.path("histories");
        if (histories.isArray() && !histories.isEmpty()) {
            return histories.get(0).path("date");
        }
        return objectMapper.nullNode();
    }

    private HttpResponse<byte[]> send(String method,
                                      String path,
                                      byte[] body,
                                      String contentType,
                                      String accept) {
        try {
            HttpRequest.Builder builder = HttpRequest.newBuilder()
                    .uri(URI.create(properties.getBaseUrl().replaceAll("/$", "") + path))
                    .timeout(Duration.ofSeconds(30))
                    .header("Authorization", basicAuthorization())
                    .header("Accept", accept);
            if (contentType != null) {
                builder.header("Content-Type", contentType);
            }
            if (body == null) {
                builder.method(method, HttpRequest.BodyPublishers.noBody());
            } else {
                builder.method(method, HttpRequest.BodyPublishers.ofByteArray(body));
            }
            return httpClient.send(builder.build(), HttpResponse.BodyHandlers.ofByteArray());
        } catch (IOException ex) {
            throw new IllegalStateException("调用 Kestra API 失败", ex);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("调用 Kestra API 被中断", ex);
        }
    }

    private Set<String> getTaskTypes() {
        Set<String> snapshot = cachedTaskTypes;
        if (snapshot != null) {
            return snapshot;
        }

        synchronized (this) {
            if (cachedTaskTypes != null) {
                return cachedTaskTypes;
            }
            HttpResponse<byte[]> response = send(
                    "GET",
                    "/api/v1/plugins",
                    null,
                    null,
                    "application/json"
            );
            if (!isSuccessful(response.statusCode())) {
                throw toKestraException(response, "查询 Kestra 插件列表失败");
            }
            try {
                JsonNode root = objectMapper.readTree(response.body());
                Set<String> taskTypes = new LinkedHashSet<>();
                if (root.isArray()) {
                    for (JsonNode plugin : root) {
                        JsonNode tasks = plugin.path("tasks");
                        if (tasks.isArray()) {
                            for (JsonNode task : tasks) {
                                String cls = readText(task.path("cls"));
                                if (cls != null && !cls.isBlank()) {
                                    taskTypes.add(cls);
                                }
                            }
                        }
                        JsonNode aliases = plugin.path("aliases");
                        if (aliases.isArray()) {
                            for (JsonNode alias : aliases) {
                                String value = readText(alias);
                                if (value != null && !value.isBlank()) {
                                    taskTypes.add(value);
                                }
                            }
                        }
                    }
                }
                cachedTaskTypes = Set.copyOf(taskTypes);
                return cachedTaskTypes;
            } catch (IOException ex) {
                throw new IllegalStateException("解析 Kestra 插件列表失败", ex);
            }
        }
    }

    private ResponseStatusException toKestraException(HttpResponse<byte[]> response, String defaultMessage) {
        String message = new String(response.body(), StandardCharsets.UTF_8);
        if (message == null || message.isBlank()) {
            message = defaultMessage;
        }
        HttpStatus status = HttpStatus.resolve(response.statusCode());
        if (status == null) {
            status = HttpStatus.BAD_GATEWAY;
        }
        return new ResponseStatusException(status, message);
    }

    private boolean isSuccessful(int statusCode) {
        return statusCode >= 200 && statusCode < 300;
    }

    private boolean shouldRetryFlowUpdate(HttpResponse<byte[]> response) {
        if (response.statusCode() == 409) {
            return true;
        }
        String body = new String(response.body(), StandardCharsets.UTF_8);
        return body.contains("Flow id already exists");
    }

    private String readText(JsonNode node) {
        return node == null || node.isMissingNode() || node.isNull() ? null : node.asText();
    }

    private Map<String, String> readLabels(JsonNode labelsNode) {
        if (labelsNode == null || !labelsNode.isObject()) {
            return Map.of();
        }
        Map<String, String> labels = new LinkedHashMap<>();
        labelsNode.fields().forEachRemaining(entry -> labels.put(entry.getKey(), readText(entry.getValue())));
        return labels;
    }

    private Instant readInstant(JsonNode... candidates) {
        for (JsonNode candidate : candidates) {
            String value = readText(candidate);
            if (value != null && !value.isBlank()) {
                return Instant.parse(value);
            }
        }
        return null;
    }

    private String basicAuthorization() {
        String token = Base64.getEncoder().encodeToString(
                (properties.getUsername() + ":" + properties.getPassword()).getBytes(StandardCharsets.UTF_8)
        );
        return "Basic " + token;
    }

    private String encode(String value) {
        return UriUtils.encodePathSegment(value, StandardCharsets.UTF_8);
    }

    private String encodeQueryParam(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private String buildExecutionSearchPath(Map<String, String> filters, int page, int size) {
        StringBuilder path = new StringBuilder("/api/v1/")
                .append(properties.getTenant())
                .append("/executions/search?page=")
                .append(page)
                .append("&size=")
                .append(size);
        if (filters != null) {
            filters.forEach((key, value) -> {
                if (value != null && !value.isBlank()) {
                    path.append("&")
                            .append(key)
                            .append("=")
                            .append(encodeQueryParam(value));
                }
            });
        }
        return path.toString();
    }

    private byte[] buildFileUploadBody(String boundary, String path, String content) {
        String filename = Path.of(path).getFileName().toString();
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try {
            output.write(("--" + boundary + "\r\n").getBytes(StandardCharsets.UTF_8));
            output.write(("Content-Disposition: form-data; name=\"fileContent\"; filename=\"" + filename + "\"\r\n")
                    .getBytes(StandardCharsets.UTF_8));
            output.write("Content-Type: application/octet-stream\r\n\r\n".getBytes(StandardCharsets.UTF_8));
            output.write(content.getBytes(StandardCharsets.UTF_8));
            output.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
            return output.toByteArray();
        } catch (IOException ex) {
            throw new UncheckedIOException("构造 Kestra 文件上传请求失败", ex);
        }
    }

    private void ensureCredentialsConfigured() {
        if (properties.getUsername() == null || properties.getUsername().isBlank()
                || properties.getPassword() == null || properties.getPassword().isBlank()) {
            throw new IllegalStateException("Kestra 凭据未配置，请设置 wbdata.offline.kestra.username/password");
        }
    }

    private static final class NoProxySelector extends ProxySelector {
        @Override
        public List<Proxy> select(URI uri) {
            return List.of(Proxy.NO_PROXY);
        }

        @Override
        public void connectFailed(URI uri, java.net.SocketAddress sa, IOException ioe) {
        }
    }
}
