package io.wbdata.kestra.hive;

import io.kestra.core.exceptions.IllegalVariableEvaluationException;
import io.kestra.core.models.annotations.Plugin;
import io.kestra.core.models.annotations.PluginProperty;
import io.kestra.core.models.property.Property;
import io.kestra.core.models.tasks.NamespaceFiles;
import io.kestra.core.models.tasks.NamespaceFilesInterface;
import io.kestra.core.models.tasks.Output;
import io.kestra.core.models.tasks.RunnableTask;
import io.kestra.core.models.tasks.Task;
import io.kestra.core.models.tasks.runners.AbstractLogConsumer;
import io.kestra.core.models.tasks.runners.DefaultLogConsumer;
import io.kestra.core.models.tasks.runners.TargetOS;
import io.kestra.core.models.tasks.runners.TaskCommands;
import io.kestra.core.models.tasks.runners.TaskException;
import io.kestra.core.models.tasks.runners.TaskRunner;
import io.kestra.core.models.tasks.runners.TaskRunnerResult;
import io.kestra.core.runners.RunContext;
import io.kestra.core.runners.WorkingDir;
import io.kestra.core.utils.NamespaceFilesUtils;
import io.kestra.plugin.core.runner.Process;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import lombok.Builder;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.ToString;
import lombok.experimental.SuperBuilder;
import io.wbdata.kestra.internal.WbDataInternalClient;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.Duration;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 运行时从 WB-Data 后端解析 Hive 凭据（及按需渲染带参脚本）并以 beeline -w 文件传密执行 HiveSQL，
 * 避免 Flow YAML 和容器进程参数中出现任何明文密码。
 */
@SuperBuilder
@ToString(callSuper = true)
@EqualsAndHashCode(callSuper = true)
@Getter
@NoArgsConstructor
@Schema(title = "Execute a HiveSQL script via beeline with runtime credential resolution")
@Plugin
public class Query extends Task implements RunnableTask<Query.HiveQueryOutput>, NamespaceFilesInterface {

    private static final String WORKING_PW_FILE = ".wb-data-beeline.pw";
    private static final String RENDERED_SCRIPT_DIR = ".wb-data-script";

    @NotNull
    @Schema(title = "WB-Data 数据源 ID")
    private Property<Long> dataSourceId;

    @NotNull
    @Schema(title = "WB-Data 项目组 ID")
    private Property<Long> groupId;

    @Schema(title = "WB-Data 内部回调基地址")
    private Property<String> internalBaseUrl;

    @Schema(title = "WB-Data 内部接口鉴权令牌")
    private Property<String> internalToken;

    @NotNull
    @Schema(title = "工作目录中的 HQL 脚本相对路径")
    private Property<String> scriptPath;

    @Schema(title = "Hive 会话配置（--hiveconf）")
    private Property<Map<String, String>> hiveConf;

    @Schema(title = "动态脚本参数映射")
    private Property<Map<String, Object>> parameters;

    @Schema(title = "Kestra Namespace Files 配置")
    private NamespaceFiles namespaceFiles;

    @Schema(title = "执行 beeline 的容器镜像（Docker runner 时使用）")
    private Property<String> containerImage;

    @Valid
    @PluginProperty
    @Builder.Default
    @Schema(title = "命令执行器（默认 Process，本地/容器可选 Docker）")
    private TaskRunner<?> taskRunner = Process.instance();

    @Schema(title = "beeline 可执行文件路径或命令名")
    private Property<String> beelineBinary;

    @Override
    public HiveQueryOutput run(RunContext runContext) throws Exception {
        if (namespaceFiles != null
                && runContext.render(namespaceFiles.getEnabled()).as(Boolean.class).orElse(true)) {
            NamespaceFilesUtils.loadNamespaceFiles(runContext, namespaceFiles);
        }

        Long resolvedDataSourceId = renderRequiredLong(runContext, dataSourceId, "dataSourceId");
        Long resolvedGroupId = renderRequiredLong(runContext, groupId, "groupId");
        String resolvedScriptPath = renderRequiredString(runContext, scriptPath, "scriptPath");

        WorkingDir workingDir = runContext.workingDir();
        Path workRoot = workingDir.path().toAbsolutePath().normalize();
        Path sourceScriptFile = resolveSafeRelativePath(workRoot, resolvedScriptPath);
        String normalizedScriptPath = workRoot.relativize(sourceScriptFile).toString().replace('\\', '/');

        Map<String, String> renderedConf = hiveConf == null
                ? Map.of()
                : runContext.render(hiveConf).asMap(String.class, String.class);
        Map<String, String> renderedParams = renderStringParameters(runContext);
        String renderedContainerImage = containerImage == null
                ? null
                : runContext.render(containerImage).as(String.class).orElse(null);
        String resolvedBeeline = beelineBinary == null
                ? "beeline"
                : runContext.render(beelineBinary).as(String.class)
                .filter(value -> !value.isBlank())
                .orElse("beeline");
        Duration resolvedTimeout = getTimeout() == null
                ? null
                : runContext.render(getTimeout()).as(Duration.class).orElse(null);

        WbDataInternalClient client = internalClient();
        WbDataInternalClient.DataSourceCredentials credentials = client.resolveDataSource(
                runContext,
                internalBaseUrl,
                internalToken,
                resolvedGroupId,
                resolvedDataSourceId,
                "HIVE"
        );
        if (credentials.url() == null || !credentials.url().startsWith("jdbc:hive2://")) {
            throw new IllegalArgumentException("WB-Data 返回的 Hive JDBC URL 不合法");
        }

        String effectiveScriptPath = normalizedScriptPath;
        if (!renderedParams.isEmpty()) {
            String rawScript = Files.readString(sourceScriptFile, StandardCharsets.UTF_8);
            String renderedScript = client.renderScript(
                    runContext,
                    internalBaseUrl,
                    internalToken,
                    "HIVE_SQL",
                    rawScript,
                    renderedParams
            );
            String renderedRelativePath = RENDERED_SCRIPT_DIR + "/" + sanitizeFileToken(getId()) + ".hql";
            workingDir.createFile(renderedRelativePath, renderedScript.getBytes(StandardCharsets.UTF_8));
            effectiveScriptPath = renderedRelativePath;
        }

        TaskRunner<?> runner = taskRunner != null ? taskRunner : Process.instance();
        Path workingPasswordFile = null;
        if (credentials.password() != null && !credentials.password().isEmpty()) {
            workingPasswordFile = workingDir.createFile(
                    WORKING_PW_FILE,
                    credentials.password().getBytes(StandardCharsets.UTF_8)
            );
            applyPasswordFilePermissions(workingPasswordFile, runner instanceof Process);
        }

        String shellScript = buildShellScript(
                resolvedBeeline,
                credentials.url(),
                credentials.username(),
                workingPasswordFile != null,
                renderedConf,
                effectiveScriptPath
        );
        AbstractLogConsumer logConsumer = new DefaultLogConsumer(runContext);
        TaskCommands taskCommands = new HiveTaskCommands(
                renderedContainerImage,
                logConsumer,
                shellScript,
                workRoot,
                resolvedTimeout
        );

        try {
            TaskRunnerResult<?> result = runner.run(runContext, taskCommands, List.of());
            if (result.getExitCode() != 0) {
                throw new TaskException(result.getExitCode(), logConsumer);
            }
            return HiveQueryOutput.builder()
                    .exitCode(result.getExitCode())
                    .build();
        } finally {
            if (workingPasswordFile != null) {
                Files.deleteIfExists(workingPasswordFile);
            }
        }
    }

    protected WbDataInternalClient internalClient() {
        return new WbDataInternalClient();
    }

    private Map<String, String> renderStringParameters(RunContext runContext) throws IllegalVariableEvaluationException {
        if (parameters == null) {
            return Map.of();
        }
        Map<String, Object> raw = runContext.render(parameters).asMap(String.class, Object.class);
        if (raw == null || raw.isEmpty()) {
            return Map.of();
        }
        Map<String, String> result = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : raw.entrySet()) {
            if (entry.getKey() != null && entry.getValue() != null) {
                result.put(entry.getKey(), entry.getValue().toString());
            }
        }
        return result;
    }

    private Long renderRequiredLong(RunContext runContext, Property<Long> property, String name)
            throws IllegalVariableEvaluationException {
        if (property == null) {
            throw new IllegalArgumentException(name + " 不能为空");
        }
        return runContext.render(property).as(Long.class)
                .orElseThrow(() -> new IllegalArgumentException(name + " 不能为空"));
    }

    private String renderRequiredString(RunContext runContext, Property<String> property, String name)
            throws IllegalVariableEvaluationException {
        if (property == null) {
            throw new IllegalArgumentException(name + " 不能为空");
        }
        return runContext.render(property).as(String.class)
                .filter(value -> !value.isBlank())
                .orElseThrow(() -> new IllegalArgumentException(name + " 不能为空"));
    }

    private Path resolveSafeRelativePath(Path workRoot, String relativePath) {
        Path rawPath = Path.of(relativePath.trim());
        if (rawPath.isAbsolute()) {
            throw new IllegalArgumentException("scriptPath 不能为绝对路径: " + relativePath);
        }
        Path resolved = workRoot.resolve(rawPath).normalize();
        if (!resolved.startsWith(workRoot) || resolved.equals(workRoot)) {
            throw new IllegalArgumentException("scriptPath 超出工作目录范围: " + relativePath);
        }
        return resolved;
    }

    private void applyPasswordFilePermissions(Path path, boolean processRunner) {
        try {
            // Process runner 同 UID 直接读取，限定 0600；Docker runner（如 uid=1000 hive）需先读入容器内 umask 077 的 /tmp 文件
            String mode = processRunner ? "rw-------" : "rw-r--r--";
            Files.setPosixFilePermissions(path, PosixFilePermissions.fromString(mode));
        } catch (UnsupportedOperationException | IOException ignored) {
            // Best-effort POSIX permission hardening
        }
    }

    private String buildShellScript(String beelineBin,
                                    String jdbcUrl,
                                    String username,
                                    boolean hasPasswordFile,
                                    Map<String, String> conf,
                                    String effectiveScriptPath) {
        StringBuilder script = new StringBuilder("set -eu\n");
        if (hasPasswordFile) {
            script.append("pwfile=\"\"\n")
                    .append("cleanup() { [ -n \"$pwfile\" ] && rm -f \"$pwfile\" || true; }\n")
                    .append("trap cleanup EXIT\n")
                    .append("umask 077\n")
                    .append("pwfile=\"$(mktemp /tmp/wb-data-beeline-XXXXXX.pw)\"\n")
                    .append("cat ").append(shellQuote(WORKING_PW_FILE)).append(" > \"$pwfile\"\n");
        }
        script.append(shellQuote(beelineBin))
                .append(" -u ").append(shellQuote(jdbcUrl));
        if (username != null && !username.isBlank()) {
            script.append(" -n ").append(shellQuote(username));
        }
        if (hasPasswordFile) {
            script.append(" -w \"$pwfile\"");
        }
        if (conf != null && !conf.isEmpty()) {
            for (Map.Entry<String, String> entry : conf.entrySet()) {
                script.append(" --hiveconf ").append(shellQuote(entry.getKey() + "=" + entry.getValue()));
            }
        }
        script.append(" -f ").append(shellQuote(effectiveScriptPath));
        return script.toString();
    }

    private static String sanitizeFileToken(String raw) {
        if (raw == null || raw.isBlank()) {
            return "hive_query";
        }
        String sanitized = raw.replaceAll("[^a-zA-Z0-9._-]", "_");
        return sanitized.isBlank() ? "hive_query" : sanitized;
    }

    private static String shellQuote(String value) {
        return "'" + (value == null ? "" : value.replace("'", "'\"'\"'")) + "'";
    }

    @Builder
    @Getter
    public static class HiveQueryOutput implements Output {
        @Schema(title = "beeline 进程退出码")
        private final Integer exitCode;
    }

    private static final class HiveTaskCommands implements TaskCommands {
        private final String containerImage;
        private final AbstractLogConsumer logConsumer;
        private final Property<List<String>> interpreter = Property.ofValue(List.of("/bin/sh", "-c"));
        private final Property<List<String>> commands;
        private final Path workingDirectory;
        private final Duration timeout;

        private HiveTaskCommands(String containerImage,
                                 AbstractLogConsumer logConsumer,
                                 String shellScript,
                                 Path workingDirectory,
                                 Duration timeout) {
            this.containerImage = containerImage;
            this.logConsumer = logConsumer;
            this.commands = Property.ofValue(List.of("/bin/sh", "-c", shellScript));
            this.workingDirectory = workingDirectory;
            this.timeout = timeout;
        }

        @Override
        public String getContainerImage() {
            return containerImage;
        }

        @Override
        public AbstractLogConsumer getLogConsumer() {
            return logConsumer;
        }

        @Override
        public Property<List<String>> getInterpreter() {
            return interpreter;
        }

        @Override
        public Property<List<String>> getBeforeCommands() {
            return null;
        }

        @Override
        public Property<List<String>> getCommands() {
            return commands;
        }

        @Override
        public Map<String, Object> getAdditionalVars() {
            return Map.of();
        }

        @Override
        public Path getWorkingDirectory() {
            return workingDirectory;
        }

        @Override
        public Path getOutputDirectory() {
            return workingDirectory.resolve(".wb-data-output");
        }

        @Override
        public Map<String, String> getEnv() {
            return Map.of();
        }

        @Override
        public Boolean getEnableOutputDirectory() {
            return Boolean.FALSE;
        }

        @Override
        public Duration getTimeout() {
            return timeout;
        }

        @Override
        public TargetOS getTargetOS() {
            return TargetOS.LINUX;
        }
    }
}
