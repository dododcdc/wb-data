package com.wbdata.offline.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wbdata.offline.config.OfflineKestraProperties;
import com.wbdata.offline.kestra.KestraClient;
import com.wbdata.offline.kestra.KestraExecutionSnapshot;
import com.wbdata.offline.kestra.KestraLogEntry;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.util.UriUtils;

import java.io.IOException;
import java.net.Authenticator;
import java.net.PasswordAuthentication;
import java.net.Proxy;
import java.net.ProxySelector;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Kestra API 的 HTTP 传输层：认证、请求发送、错误映射与端点路径拼装。
 * JSON payload 解析见 {@link KestraPayloadParser}，multipart 构造见 {@link KestraMultipartBodies}。
 */
@Service
public class KestraHttpClient implements KestraClient {

    private final OfflineKestraProperties properties;
    private final KestraPayloadParser payloadParser;
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
        this.payloadParser = new KestraPayloadParser(objectMapper);
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
            throw toKestraException(createResponse, "创建任务失败");
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
            throw toKestraException(updateResponse, "更新任务失败");
        }
    }

    @Override
    public void deleteFlow(String namespace, String flowId) {
        ensureCredentialsConfigured();
        HttpResponse<byte[]> response = send(
                "DELETE",
                "/api/v1/" + properties.getTenant() + "/flows/" + encode(namespace) + "/" + encode(flowId),
                null,
                null,
                "application/json"
        );
        if (!(response.statusCode() == 200 || response.statusCode() == 204 || response.statusCode() == 404)) {
            throw toKestraException(response, "删除任务失败");
        }
    }

    @Override
    public List<String> validateFlow(String source) {
        ensureCredentialsConfigured();
        HttpResponse<byte[]> response = send(
                "POST",
                "/api/v1/" + properties.getTenant() + "/flows/validate",
                source.getBytes(StandardCharsets.UTF_8),
                "application/x-yaml",
                "application/json"
        );
        if (!isSuccessful(response.statusCode())) {
            throw toKestraException(response, "校验任务失败");
        }
        return payloadParser.readViolations(response.body());
    }

    @Override
    public void upsertNamespaceFile(String namespace, String path, String content) {
        ensureCredentialsConfigured();
        String boundary = "----wb-data-file-" + UUID.randomUUID().toString().replace("-", "");
        byte[] body = KestraMultipartBodies.fileUploadBody(boundary, path, content);
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
    public KestraExecutionSnapshot createExecution(String namespace,
                                                    String flowId,
                                                    Map<String, String> inputs,
                                                    Map<String, String> labels) {
        ensureCredentialsConfigured();
        String boundary = "----wb-data-" + UUID.randomUUID().toString().replace("-", "");
        byte[] body = KestraMultipartBodies.executionBody(boundary, inputs);
        HttpResponse<byte[]> response = send(
                "POST",
                buildCreateExecutionPath(namespace, flowId, labels),
                body,
                "multipart/form-data; boundary=" + boundary,
                "application/json"
        );
        if (!isSuccessful(response.statusCode())) {
            throw toKestraException(response, "创建执行失败");
        }
        return payloadParser.readExecution(response.body());
    }

    private String buildCreateExecutionPath(String namespace,
                                            String flowId,
                                            Map<String, String> labels) {
        String path = "/api/v1/" + properties.getTenant()
                + "/executions/" + encode(namespace) + "/" + encode(flowId);
        if (labels == null || labels.isEmpty()) {
            return path;
        }
        String query = labels.entrySet().stream()
                .map(entry -> "labels=" + encodeQueryParam(entry.getKey() + ":" + entry.getValue()))
                .collect(java.util.stream.Collectors.joining("&"));
        return path + "?" + query;
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
                JsonNode root = payloadParser.readTree(response.body());
                JsonNode results = root.path("results");
                if (!results.isArray() || results.isEmpty()) {
                    break;
                }
                for (JsonNode item : results) {
                    executions.add(payloadParser.readExecution(item));
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
        return payloadParser.readFlowSource(response.body());
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
        return payloadParser.readExecution(response.body());
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
        return payloadParser.readLogs(response.body(), taskId);
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
            cachedTaskTypes = payloadParser.readTaskTypes(response.body());
            return cachedTaskTypes;
        }
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
