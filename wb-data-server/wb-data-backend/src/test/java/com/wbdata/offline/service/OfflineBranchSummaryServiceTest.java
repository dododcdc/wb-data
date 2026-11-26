package com.wbdata.offline.service;

import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.repo.service.RepoLockManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class OfflineBranchSummaryServiceTest {

    @TempDir
    Path tempDir;

    private OfflineProperties offlineProperties;
    private OfflineBranchSummaryService service;

    @BeforeEach
    void setUp() {
        offlineProperties = new OfflineProperties();
        offlineProperties.setRepoBaseDir(tempDir.toString());
        service = new OfflineBranchSummaryService(offlineProperties, new RepoLockManager());
    }

    @Test
    void summarizesMainBranchWithoutSwitchingDirtyWorkingTree() throws Exception {
        Long groupId = 10L;
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        Files.createDirectories(repoPath);

        runGit(repoPath, "init", "-b", "main");
        runGit(repoPath, "config", "user.name", "Tester");
        runGit(repoPath, "config", "user.email", "tester@example.com");

        // main 分支提交 2 个任务：1 个启用调度（含中文注释以验证 UTF-8 字节计数），1 个禁用调度
        writeFlow(repoPath, "_flows/ods/flow_enabled/flow.yaml", """
                id: flow_enabled
                namespace: g10-main
                # 中文注释用于校验 git cat-file --batch 字节长度与 UTF-8 长度不同时的切片
                tasks: []
                triggers:
                  - id: schedule
                    type: io.kestra.plugin.core.trigger.Schedule
                    cron: "0 2 * * *"
                    disabled: false
                """);
        writeFlow(repoPath, "_flows/dwd/flow_disabled/flow.yaml", """
                id: flow_disabled
                namespace: g10-main
                tasks: []
                triggers:
                  - id: schedule
                    type: io.kestra.plugin.core.trigger.Schedule
                    cron: "0 3 * * *"
                    disabled: true
                """);
        runGit(repoPath, "add", ".");
        runGit(repoPath, "commit", "-m", "init main flows");

        // 切到 feature 分支新增已提交任务 + 未提交草稿
        runGit(repoPath, "switch", "-c", "feature/policy-review");
        writeFlow(repoPath, "_flows/ads/flow_feature/flow.yaml", """
                id: flow_feature
                namespace: g10-feature
                tasks: []
                triggers:
                  - id: schedule
                    type: io.kestra.plugin.core.trigger.Schedule
                    cron: "0 * * * *"
                """);
        runGit(repoPath, "add", ".");
        runGit(repoPath, "commit", "-m", "feat: add feature flow");

        writeFlow(repoPath, "_flows/ads/flow_uncommitted/flow.yaml", """
                id: flow_uncommitted
                namespace: g10-feature
                tasks: []
                """);

        List<String> branches = service.listAvailableBranches(groupId);
        assertThat(branches).containsExactlyInAnyOrder("main", "feature/policy-review");

        OfflineBranchSummaryService.BranchSnapshotSummary mainSummary = service.summarizeBranch(groupId, "main");
        assertThat(mainSummary.exists()).isTrue();
        assertThat(mainSummary.branch()).isEqualTo("main");
        assertThat(mainSummary.headCommitMessage()).isEqualTo("init main flows");
        assertThat(mainSummary.headCommitAt()).isNotNull();
        assertThat(mainSummary.flowCount()).isEqualTo(2);
        assertThat(mainSummary.scheduledFlowCount()).isEqualTo(1);

        // 第二次读取应命中按 commit SHA 的缓存并保持一致
        OfflineBranchSummaryService.BranchSnapshotSummary cachedMainSummary = service.summarizeBranch(groupId, "main");
        assertThat(cachedMainSummary).isEqualTo(mainSummary);

        // 验证本地工作区未被切换且未提交草稿仍保留
        String currentBranch = runGit(repoPath, "branch", "--show-current").trim();
        assertThat(currentBranch).isEqualTo("feature/policy-review");
        assertThat(Files.exists(repoPath.resolve("_flows/ads/flow_uncommitted/flow.yaml"))).isTrue();
    }

    @Test
    void returnsNotFoundForMissingOrInvalidBranchAndUninitializedRepo() {
        Long groupId = 99L;
        assertThat(service.listAvailableBranches(groupId)).isEmpty();
        assertThat(service.summarizeBranch(groupId, "main").exists()).isFalse();
        assertThat(service.summarizeBranch(groupId, "--bad-flag").exists()).isFalse();
        assertThat(service.summarizeBranch(groupId, "bad..branch").exists()).isFalse();
    }

    private static void writeFlow(Path repoPath, String relativePath, String content) throws IOException {
        Path target = repoPath.resolve(relativePath);
        Files.createDirectories(target.getParent());
        Files.writeString(target, content, StandardCharsets.UTF_8);
    }

    private static String runGit(Path repoPath, String... args) throws Exception {
        List<String> cmd = new ArrayList<>();
        cmd.add("git");
        cmd.add("-C");
        cmd.add(repoPath.toString());
        cmd.addAll(List.of(args));
        Process process = new ProcessBuilder(cmd).redirectErrorStream(true).start();
        String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        int exit = process.waitFor();
        if (exit != 0) {
            throw new IllegalStateException("git failed: " + String.join(" ", cmd) + "\n" + output);
        }
        return output;
    }
}
