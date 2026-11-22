package io.wbdata.kestra.internal;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.kestra.core.exceptions.IllegalVariableEvaluationException;
import io.kestra.core.models.property.Property;
import io.kestra.core.runners.RunContext;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.function.UnaryOperator;

/**
 * Kestra 插件运行时回调 WB-Data 后端内部接口的共享 HTTP 客户端。
 */
public class WbDataInternalClient {

    public static final String INTERNAL_TOKEN_HEADER = "X-WB-Data-Internal-Token";
    public static final String DEFAULT_BASE_URL_ENV = "WB_DATA_INTERNAL_BASE_URL";
    public static final String DEFAULT_TOKEN_ENV = "WB_DATA_INTERNAL_TOKEN";

    private static final String DATASOURCE_CREDENTIALS_PATH = "/api/v1/internal/offline/credentials/datasource";
    private static final String GIT_CREDENTIALS_PATH = "/api/v1/internal/offline/credentials/git";
    private static final String SCRIPT_RENDER_PATH = "/api/v1/internal/offline/script/render";
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(30);

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    private final HttpClient httpClient;
    private final UnaryOperator<String> envLookup;

    public WbDataInternalClient() {
        this(HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofSeconds(10))
                .build(), System::getenv);
    }

    public WbDataInternalClient(HttpClient httpClient, UnaryOperator<String> envLookup) {
        this.httpClient = httpClient;
        this.envLookup = envLookup;
    }

    public DataSourceCredentials resolveDataSource(RunContext runContext,
                                                     Property<String> internalBaseUrl,
                                                     Property<String> internalToken,
                                                     Long groupId,
                                                     Long dataSourceId,
                                                     String expectedType)
            throws IOException, InterruptedException, IllegalVariableEvaluationException {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("groupId", groupId);
        payload.put("dataSourceId", dataSourceId);
        if (expectedType != null && !expectedType.isBlank()) {
            payload.put("expectedType", expectedType);
        }
        String body = postJson(runContext, internalBaseUrl, internalToken, DATASOURCE_CREDENTIALS_PATH, payload);
        DataSourceCredentials credentials = OBJECT_MAPPER.readValue(body, DataSourceCredentials.class);
        if (credentials == null || credentials.url() == null || credentials.url().isBlank()) {
            throw new IllegalStateException("WB-Data 后端返回了无效的数据源凭据响应 (dataSourceId=" + dataSourceId + ")");
        }
        return credentials;
    }

    public GitCredentials resolveGit(RunContext runContext,
                                     Property<String> internalBaseUrl,
                                     Property<String> internalToken,
                                     Long groupId)
            throws IOException, InterruptedException, IllegalVariableEvaluationException {
        Map<String, Object> payload = Map.of("groupId", groupId);
        String body = postJson(runContext, internalBaseUrl, internalToken, GIT_CREDENTIALS_PATH, payload);
        GitCredentials credentials = OBJECT_MAPPER.readValue(body, GitCredentials.class);
        if (credentials == null
                || credentials.repositoryUrl() == null || credentials.repositoryUrl().isBlank()
                || credentials.username() == null || credentials.username().isBlank()) {
            throw new IllegalStateException("WB-Data 后端返回了无效的 Git 凭据响应 (groupId=" + groupId + ")");
        }
        return credentials;
    }

    public String renderScript(RunContext runContext,
                               Property<String> internalBaseUrl,
                               Property<String> internalToken,
                               String kind,
                               String scriptContent,
                               Map<String, String> parameters)
            throws IOException, InterruptedException, IllegalVariableEvaluationException {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("kind", kind);
        payload.put("script", Base64.getEncoder().encodeToString(
                (scriptContent == null ? "" : scriptContent).getBytes(StandardCharsets.UTF_8)));
        payload.put("parameters", parameters == null ? Map.of() : parameters);
        return postJson(runContext, internalBaseUrl, internalToken, SCRIPT_RENDER_PATH, payload);
    }

    String resolveBaseUrl(RunContext runContext, Property<String> internalBaseUrl)
            throws IllegalVariableEvaluationException {
        String configured = null;
        if (internalBaseUrl != null) {
            configured = runContext.render(internalBaseUrl).as(String.class).orElse(null);
        }
        if (configured == null || configured.isBlank()) {
            configured = readPluginConfig(runContext, "internalBaseUrl").orElse(null);
        }
        if (configured == null || configured.isBlank()) {
            configured = envLookup.apply(DEFAULT_BASE_URL_ENV);
        }
        if (configured == null || configured.isBlank()) {
            throw new IllegalStateException(
                    "WB-Data internalBaseUrl 未配置：请在任务属性、插件配置或环境变量 "
                            + DEFAULT_BASE_URL_ENV + " 中配置");
        }
        return stripTrailingSlashes(configured.trim());
    }

    String resolveToken(RunContext runContext, Property<String> internalToken)
            throws IllegalVariableEvaluationException {
        String configured = null;
        if (internalToken != null) {
            configured = runContext.render(internalToken).as(String.class).orElse(null);
        }
        if (configured == null || configured.isBlank()) {
            configured = readPluginConfig(runContext, "internalToken").orElse(null);
        }
        if (configured == null || configured.isBlank()) {
            configured = envLookup.apply(DEFAULT_TOKEN_ENV);
        }
        if (configured == null || configured.isBlank()) {
            throw new IllegalStateException(
                    "WB-Data internalToken 未配置：请在 Kestra 中配置 SECRET_" + DEFAULT_TOKEN_ENV);
        }
        return configured;
    }

    private Optional<String> readPluginConfig(RunContext runContext, String key) {
        if (runContext == null) {
            return Optional.empty();
        }
        return runContext.pluginConfiguration(key)
                .map(Object::toString)
                .map(String::trim)
                .filter(value -> !value.isBlank());
    }

    private String postJson(RunContext runContext,
                            Property<String> internalBaseUrl,
                            Property<String> internalToken,
                            String endpointPath,
                            Object payload)
            throws IOException, InterruptedException, IllegalVariableEvaluationException {
        String baseUrl = resolveBaseUrl(runContext, internalBaseUrl);
        String token = resolveToken(runContext, internalToken);
        String requestJson = OBJECT_MAPPER.writeValueAsString(payload);

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl + endpointPath))
                .timeout(REQUEST_TIMEOUT)
                .header("Content-Type", "application/json")
                .header(INTERNAL_TOKEN_HEADER, token)
                .POST(HttpRequest.BodyPublishers.ofString(requestJson, StandardCharsets.UTF_8))
                .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            String detail = summarizeErrorBody(response.body(), token);
            String suffix = detail.isEmpty() ? "" : ": " + detail;
            throw new IllegalStateException("调用 WB-Data 内部接口 " + endpointPath
                    + " 失败，HTTP " + response.statusCode() + suffix);
        }
        return response.body();
    }

    private static String summarizeErrorBody(String body, String token) {
        if (body == null || body.isBlank()) {
            return "";
        }
        String sanitized = body;
        if (token != null && !token.isEmpty()) {
            sanitized = sanitized.replace(token, "***");
        }
        try {
            var tree = OBJECT_MAPPER.readTree(sanitized);
            if (tree != null && tree.isObject()) {
                for (String field : new String[]{"message", "reason", "error"}) {
                    if (tree.hasNonNull(field)) {
                        String text = tree.get(field).asText("");
                        if (!text.isBlank()) {
                            return truncate(text);
                        }
                    }
                }
            }
        } catch (IOException ignored) {
            // Fall back to sanitized plain text summary
        }
        return truncate(sanitized.replaceAll("[\\r\\n]+", " ").trim());
    }

    private static String truncate(String text) {
        if (text == null) {
            return "";
        }
        return text.length() <= 200 ? text : text.substring(0, 200) + "...";
    }

    private static String stripTrailingSlashes(String value) {
        int end = value.length();
        while (end > 0 && value.charAt(end - 1) == '/') {
            end--;
        }
        return value.substring(0, end);
    }

    public record DataSourceCredentials(
            Long dataSourceId,
            String type,
            String url,
            String username,
            String password
    ) {
    }

    public record GitCredentials(
            Long groupId,
            String provider,
            String repositoryUrl,
            String username,
            String token
    ) {
    }
}
