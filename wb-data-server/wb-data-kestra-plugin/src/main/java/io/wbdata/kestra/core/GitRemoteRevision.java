package io.wbdata.kestra.core;

import io.kestra.core.exceptions.IllegalVariableEvaluationException;
import io.kestra.core.models.annotations.Plugin;
import io.kestra.core.models.property.Property;
import io.kestra.core.models.tasks.Output;
import io.kestra.core.models.tasks.RunnableTask;
import io.kestra.core.models.tasks.Task;
import io.kestra.core.runners.RunContext;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import lombok.Builder;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.experimental.SuperBuilder;
import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.lib.Ref;
import org.eclipse.jgit.transport.UsernamePasswordCredentialsProvider;

import java.util.Map;

@SuperBuilder
@EqualsAndHashCode
@Getter
@NoArgsConstructor
@Schema(title = "读取远端 Git 分支的提交 SHA")
@Plugin
public class GitRemoteRevision extends Task implements RunnableTask<GitRemoteRevision.RevisionOutput> {

    @NotNull
    @Schema(title = "Git 仓库地址")
    private Property<String> url;

    @NotNull
    @Schema(title = "分支名称")
    private Property<String> branch;

    @Schema(title = "可选用户名")
    private Property<String> username;

    @Schema(title = "可选密码或访问令牌")
    private Property<String> password;

    @Override
    public RevisionOutput run(RunContext runContext) throws Exception {
        String renderedUrl = renderRequired(runContext, url, "url");
        String renderedBranch = renderRequired(runContext, branch, "branch");
        String renderedUsername = runContext.render(username).as(String.class).orElse(null);
        String renderedPassword = runContext.render(password).as(String.class).orElse(null);
        return RevisionOutput.builder()
                .sha(resolveBranchSha(renderedUrl, renderedBranch, renderedUsername, renderedPassword))
                .build();
    }

    static String resolveBranchSha(String url, String branch, String username, String password) throws Exception {
        var command = Git.lsRemoteRepository().setRemote(url);
        if (username != null && !username.isBlank()) {
            command.setCredentialsProvider(new UsernamePasswordCredentialsProvider(
                    username, password == null ? "" : password));
        }
        Map<String, Ref> refs = command.callAsMap();
        Ref branchRef = refs.get("refs/heads/" + branch);
        if (branchRef == null) {
            throw new IllegalArgumentException("远端分支不存在: " + branch);
        }
        return branchRef.getObjectId().getName();
    }

    private String renderRequired(RunContext runContext, Property<String> property, String name)
            throws IllegalVariableEvaluationException {
        return runContext.render(property).as(String.class)
                .filter(value -> !value.isBlank())
                .orElseThrow(() -> new IllegalArgumentException(name + " 不能为空"));
    }

    @Builder
    @Getter
    public static class RevisionOutput implements Output {
        @Schema(title = "远端分支当前提交 SHA")
        private final String sha;
    }
}
