package io.wbdata.kestra.jdbc;

import io.kestra.core.exceptions.IllegalVariableEvaluationException;
import io.kestra.core.models.property.Property;
import io.kestra.core.runners.RunContext;
import io.wbdata.kestra.internal.WbDataInternalClient;

import java.io.IOException;
import java.util.Properties;

/**
 * 为自定义 JDBC 查询插件提供统一的延迟 URL 占位与运行时凭据解析。
 */
public final class JdbcCredentialSupport {

    private static final String DEFERRED_HOST = "wbdata-deferred";

    private JdbcCredentialSupport() {
    }

    public static Property<String> resolveDeferredUrl(Property<String> configuredUrl,
                                                      Property<Long> dataSourceId,
                                                      String scheme) {
        if (configuredUrl != null) {
            return configuredUrl;
        }
        if (dataSourceId != null) {
            return Property.ofValue(scheme + "://" + DEFERRED_HOST);
        }
        return null;
    }

    public static Properties resolveConnectionProperties(RunContext runContext,
                                                         Property<Long> dataSourceId,
                                                         Property<Long> groupId,
                                                         Property<String> internalBaseUrl,
                                                         Property<String> internalToken,
                                                         String expectedType,
                                                         String expectedScheme,
                                                         WbDataInternalClient client)
            throws IOException, InterruptedException, IllegalVariableEvaluationException {
        Long resolvedDsId = runContext.render(dataSourceId).as(Long.class)
                .orElseThrow(() -> new IllegalArgumentException("dataSourceId 不能为空"));
        if (groupId == null) {
            throw new IllegalArgumentException("使用 dataSourceId 运行时解析时必须提供 groupId");
        }
        Long resolvedGroupId = runContext.render(groupId).as(Long.class)
                .orElseThrow(() -> new IllegalArgumentException("groupId 不能为空"));

        WbDataInternalClient.DataSourceCredentials credentials = client.resolveDataSource(
                runContext,
                internalBaseUrl,
                internalToken,
                resolvedGroupId,
                resolvedDsId,
                expectedType
        );

        String url = credentials.url();
        if (url == null || url.isBlank() || (expectedScheme != null && !url.startsWith(expectedScheme))) {
            throw new IllegalArgumentException(
                    "WB-Data 返回的 JDBC URL 与期望协议 " + expectedScheme + " 不匹配");
        }

        // 直接写入 Properties，避免密码等敏感字段经 Pebble 二次渲染
        Properties props = new Properties();
        props.put("jdbc.url", url);
        if (credentials.username() != null) {
            props.put("user", credentials.username());
        }
        if (credentials.password() != null) {
            props.put("password", credentials.password());
        }
        return props;
    }
}
