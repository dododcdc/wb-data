package io.wbdata.kestra.jdbc.mysql;

import io.kestra.core.exceptions.IllegalVariableEvaluationException;
import io.kestra.core.models.annotations.Plugin;
import io.kestra.core.models.property.Property;
import io.kestra.core.runners.RunContext;
import io.wbdata.kestra.internal.WbDataInternalClient;
import io.wbdata.kestra.jdbc.JdbcCredentialSupport;
import io.wbdata.kestra.jdbc.SqlAwarePreparedStatement;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.ToString;
import lombok.experimental.SuperBuilder;

import java.nio.file.Path;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.Map;
import java.util.Properties;

@SuperBuilder
@ToString(callSuper = true)
@EqualsAndHashCode(callSuper = true)
@Getter
@NoArgsConstructor
@Schema(title = "Execute a SQL-aware parameterized query against MySQL")
@Plugin
public class Query extends io.kestra.plugin.jdbc.mysql.Query {

    @Schema(title = "WB-Data 数据源 ID，配置后在运行时向后端解析连接凭据")
    private Property<Long> dataSourceId;

    @Schema(title = "WB-Data 项目组 ID")
    private Property<Long> groupId;

    @Schema(title = "WB-Data 内部回调基地址")
    private Property<String> internalBaseUrl;

    @Schema(title = "WB-Data 内部接口鉴权令牌")
    private Property<String> internalToken;

    @Override
    public Property<String> getUrl() {
        return JdbcCredentialSupport.resolveDeferredUrl(super.getUrl(), dataSourceId, getScheme());
    }

    @Override
    public Properties connectionProperties(RunContext runContext) throws Exception {
        if (dataSourceId == null) {
            if (this.workingDirectory == null) {
                this.workingDirectory = resolveWorkingDirectory(runContext);
            }
            return super.connectionProperties(runContext);
        }
        Properties props = JdbcCredentialSupport.resolveConnectionProperties(
                runContext,
                dataSourceId,
                groupId,
                internalBaseUrl,
                internalToken,
                "MYSQL",
                getScheme(),
                internalClient()
        );
        Path wd = resolveWorkingDirectory(runContext);
        return this.createMysqlProperties(props, wd, false);
    }

    @Override
    protected PreparedStatement prepareStatement(RunContext runContext,
                                                 Connection connection,
                                                 String sql) throws SQLException, IllegalVariableEvaluationException {
        Map<String, Object> parameters = runContext.render(getParameters()).asMap(String.class, Object.class);
        return SqlAwarePreparedStatement.prepare(connection, sql, parameters, this::createPreparedStatement);
    }

    protected WbDataInternalClient internalClient() {
        return new WbDataInternalClient();
    }

    private Path resolveWorkingDirectory(RunContext runContext) {
        if (runContext != null && runContext.workingDir() != null && runContext.workingDir().path() != null) {
            return runContext.workingDir().path();
        }
        if (this.workingDirectory != null) {
            return this.workingDirectory;
        }
        return Path.of(System.getProperty("java.io.tmpdir"));
    }
}
