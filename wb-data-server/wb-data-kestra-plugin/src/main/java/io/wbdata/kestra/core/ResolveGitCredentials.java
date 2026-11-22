package io.wbdata.kestra.core;

import io.kestra.core.exceptions.IllegalVariableEvaluationException;
import io.kestra.core.models.annotations.Plugin;
import io.kestra.core.models.property.Property;
import io.kestra.core.models.tasks.Output;
import io.kestra.core.models.tasks.RunnableTask;
import io.kestra.core.models.tasks.Task;
import io.kestra.core.models.tasks.common.EncryptedString;
import io.kestra.core.runners.RunContext;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import lombok.Builder;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.ToString;
import lombok.experimental.SuperBuilder;
import io.wbdata.kestra.internal.WbDataInternalClient;

@SuperBuilder
@ToString
@EqualsAndHashCode(callSuper = true)
@Getter
@NoArgsConstructor
@Schema(title = "运行时从 WB-Data 后端解析项目组 Git 凭据")
@Plugin
public class ResolveGitCredentials extends Task implements RunnableTask<ResolveGitCredentials.GitCredentialsOutput> {

    @NotNull
    @Schema(title = "项目组 ID")
    private Property<Long> groupId;

    @Schema(title = "WB-Data 内部回调基地址")
    private Property<String> internalBaseUrl;

    @Schema(title = "WB-Data 内部接口鉴权令牌")
    private Property<String> internalToken;

    @Override
    public GitCredentialsOutput run(RunContext runContext) throws Exception {
        Long resolvedGroupId = renderRequiredGroupId(runContext);
        WbDataInternalClient.GitCredentials credentials = internalClient().resolveGit(
                runContext,
                internalBaseUrl,
                internalToken,
                resolvedGroupId
        );
        String rawToken = credentials.token();
        EncryptedString encryptedToken = (rawToken == null || rawToken.isEmpty())
                ? null
                : EncryptedString.from(rawToken, runContext);

        return GitCredentialsOutput.builder()
                .repositoryUrl(credentials.repositoryUrl())
                .username(credentials.username())
                .token(encryptedToken)
                .build();
    }

    protected WbDataInternalClient internalClient() {
        return new WbDataInternalClient();
    }

    private Long renderRequiredGroupId(RunContext runContext) throws IllegalVariableEvaluationException {
        return runContext.render(groupId).as(Long.class)
                .orElseThrow(() -> new IllegalArgumentException("groupId 不能为空"));
    }

    @Builder
    @Getter
    public static class GitCredentialsOutput implements Output {
        @Schema(title = "远端仓库地址")
        private final String repositoryUrl;

        @Schema(title = "Git 用户名")
        private final String username;

        @Schema(title = "经 Kestra 加密后的访问令牌")
        private final EncryptedString token;
    }
}
