package com.wbdata.offline.service;

import com.wbdata.auth.dto.ProjectGroupContextItem;
import com.wbdata.auth.service.PermissionService;
import com.wbdata.offline.dto.SaveOfflineFlowDocumentRequest;
import com.wbdata.offline.enums.OfflineCrossGroupDependency;
import com.wbdata.offline.enums.OfflineFailurePolicy;
import com.wbdata.offline.enums.OfflineSchedulePeriod;
import com.wbdata.offline.repo.dto.OfflineRepoTreeResponse;
import com.wbdata.offline.schedule.dto.OfflineFlowDependencyRef;
import com.wbdata.offline.schedule.dto.OfflineFlowDependencySettings;
import com.wbdata.offline.schedule.dto.OfflineFlowSchedule;
import com.wbdata.offline.schedule.dto.UpdateOfflineDependenciesRequest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.web.server.ResponseStatusException;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class OfflineFlowDependencyIndexModeTest {

    @TempDir
    Path tempDir;

    @Test
    void saveDocumentFastPathDoesNotBlockOnOtherGroupLock() throws Exception {
        OfflineFlowIndexServiceTest.InMemoryIndexFixture indexFixture =
                new OfflineFlowIndexServiceTest.InMemoryIndexFixture(tempDir, true);
        TestServices services = new TestServices(indexFixture);

        Path existing = indexFixture.writeFlow(1L, "_flows/task_a/flow.yaml",
                OfflineFlowIndexServiceTest.scheduledFlow("task_a", 1L, ""));
        indexFixture.writeFlow(2L, "_flows/task_b/flow.yaml",
                OfflineFlowIndexServiceTest.scheduledFlow("task_b", 2L, ""));
        indexFixture.indexService.reconcileAllExistingGroupsAtStartup();

        SaveOfflineFlowDocumentRequest request = new SaveOfflineFlowDocumentRequest(
                1L,
                "_flows/task_a/flow.yaml",
                null,
                0L,
                List.of(),
                List.of(),
                null,
                new OfflineFlowSchedule("0 3 * * *", "Asia/Shanghai", true, OfflineSchedulePeriod.DAILY),
                null,
                null,
                "Asia/Shanghai",
                null
        );

        CountDownLatch group2Locked = new CountDownLatch(1);
        CountDownLatch releaseGroup2 = new CountDownLatch(1);
        ExecutorService executor = Executors.newSingleThreadExecutor();
        try {
            Future<?> blocker = executor.submit(() -> indexFixture.repoLockManager.withLock(2L, () -> {
                group2Locked.countDown();
                try {
                    assertThat(releaseGroup2.await(5, TimeUnit.SECONDS)).isTrue();
                } catch (InterruptedException ex) {
                    Thread.currentThread().interrupt();
                }
                return null;
            }));

            assertThat(group2Locked.await(3, TimeUnit.SECONDS)).isTrue();

            // Group 1 fast-path save (same period DAILY, no dependency change) must complete while group 2 is locked
            String result = services.dependencyService.saveDocument(
                    request,
                    groups(1L, 2L),
                    () -> {
                        try {
                            Files.writeString(existing, OfflineFlowIndexServiceTest.scheduledFlow("task_a", 1L, "")
                                    .replace("0 1 * * *", "0 3 * * *"));
                            indexFixture.indexService.onFlowSaved(1L, "_flows/task_a/flow.yaml",
                                    Files.readString(existing), existing);
                            return "ok";
                        } catch (Exception ex) {
                            throw new RuntimeException(ex);
                        }
                    });
            assertThat(result).isEqualTo("ok");

            releaseGroup2.countDown();
            blocker.get(3, TimeUnit.SECONDS);
        } finally {
            releaseGroup2.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    void slowPathValidatesCycleDuplicatesAndUpdatesIndexViaWriteThrough() throws Exception {
        OfflineFlowIndexServiceTest.InMemoryIndexFixture indexFixture =
                new OfflineFlowIndexServiceTest.InMemoryIndexFixture(tempDir, true);
        TestServices services = new TestServices(indexFixture);

        indexFixture.writeFlow(1L, "_flows/up/flow.yaml", OfflineFlowIndexServiceTest.scheduledFlow("up", 1L, ""));
        indexFixture.writeFlow(2L, "_flows/down/flow.yaml", OfflineFlowIndexServiceTest.scheduledFlow("down", 2L, ""));
        indexFixture.indexService.reconcileAllExistingGroupsAtStartup();

        var downContent = services.contentService.getFlowContent(2L, "_flows/down/flow.yaml");
        services.dependencyService.updateConfig(
                new UpdateOfflineDependenciesRequest(
                        2L,
                        "_flows/down/flow.yaml",
                        List.of(new OfflineFlowDependencyRef(1L, "up")),
                        OfflineFailurePolicy.PAUSE,
                        OfflineCrossGroupDependency.ALLOW,
                        downContent.contentHash(),
                        downContent.fileUpdatedAt()),
                groups(1L, 2L));

        assertThat(services.dependencyService.findDependents(1L, "_flows/up/flow.yaml", groups(1L, 2L)))
                .extracting(item -> item.flowId())
                .containsExactly("down");

        // Adding reverse dependency 2:down on up must fail as cycle
        var upContent = services.contentService.getFlowContent(1L, "_flows/up/flow.yaml");
        assertThatThrownBy(() -> services.dependencyService.updateConfig(
                new UpdateOfflineDependenciesRequest(
                        1L,
                        "_flows/up/flow.yaml",
                        List.of(new OfflineFlowDependencyRef(2L, "down")),
                        OfflineFailurePolicy.CONTINUE,
                        OfflineCrossGroupDependency.ALLOW,
                        upContent.contentHash(),
                        upContent.fileUpdatedAt()),
                groups(1L, 2L)))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getStatusCode().value()).isEqualTo(422))
                .hasMessageContaining("循环");

        // Saving a different nested path with the same folder/flowId "up" must fail
        assertThatThrownBy(() -> services.dependencyService.saveDocument(
                new SaveOfflineFlowDocumentRequest(
                        1L, "_flows/nested/up/flow.yaml", null, 0L,
                        List.of(), List.of(), null, null, null, null, null,
                        new OfflineFlowDependencySettings(List.of(), OfflineFailurePolicy.CONTINUE,
                                OfflineCrossGroupDependency.ALLOW)),
                groups(1L),
                () -> "should-not-save"))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getStatusCode().value()).isEqualTo(422))
                .hasMessageContaining("任务标识已存在");
    }

    @Test
    void assertFolderDeletionAllowedAllowsInternalOnlyAndBlocksExternalWithMasking() throws Exception {
        OfflineFlowIndexServiceTest.InMemoryIndexFixture indexFixture =
                new OfflineFlowIndexServiceTest.InMemoryIndexFixture(tempDir, true);
        TestServices services = new TestServices(indexFixture);

        indexFixture.writeFlow(1L, "_flows/internal_only/a/flow.yaml",
                OfflineFlowIndexServiceTest.scheduledFlow("a", 1L, ""));
        indexFixture.writeFlow(1L, "_flows/internal_only/b/flow.yaml",
                OfflineFlowIndexServiceTest.scheduledFlow("b", 1L, "1:a"));
        indexFixture.writeFlow(1L, "_flows/shared/x/flow.yaml",
                OfflineFlowIndexServiceTest.scheduledFlow("x", 1L, ""));
        indexFixture.writeFlow(2L, "_flows/ext/y/flow.yaml",
                OfflineFlowIndexServiceTest.scheduledFlow("y", 2L, "1:x"));
        indexFixture.indexService.reconcileAllExistingGroupsAtStartup();

        services.dependencyService.assertFolderDeletionAllowed(1L, "_flows/internal_only", groups(1L, 2L));

        assertThatThrownBy(() -> services.dependencyService.assertFolderDeletionAllowed(
                1L, "_flows/shared", groups(1L, 2L)))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getStatusCode().value()).isEqualTo(422))
                .hasMessageContaining("无法删除文件夹")
                .hasMessageContaining("group-2/y");

        // Without access to group 2, error must redact group-2/y
        assertThatThrownBy(() -> services.dependencyService.assertFolderDeletionAllowed(
                1L, "_flows/shared", groups(1L)))
                .isInstanceOfSatisfying(ResponseStatusException.class, ex -> {
                    assertThat(ex.getStatusCode().value()).isEqualTo(422);
                    assertThat(ex.getReason()).contains("存在无权查看的下游任务");
                    assertThat(ex.getReason()).doesNotContain("group-2", "y");
                });
    }

    @Test
    void repoTreeUsesIndexMetadataAndSelfHealsMissingDiskFile() throws Exception {
        OfflineFlowIndexServiceTest.InMemoryIndexFixture indexFixture =
                new OfflineFlowIndexServiceTest.InMemoryIndexFixture(tempDir, true);
        TestServices services = new TestServices(indexFixture);

        Path indexedFile = indexFixture.writeFlow(1L, "_flows/indexed/flow.yaml",
                OfflineFlowIndexServiceTest.scheduledFlow("indexed", 1L, ""));
        indexFixture.indexService.reconcileAllExistingGroupsAtStartup();

        // Corrupt indexed file on disk while keeping matching file length + mtime so index-backed tree proves no disk YAML parse
        String original = Files.readString(indexedFile);
        var originalMtime = Files.getLastModifiedTime(indexedFile);
        Files.writeString(indexedFile, " ".repeat(original.length()));
        Files.setLastModifiedTime(indexedFile, originalMtime);

        // Manually add a brand-new flow on disk after reconcile without notifying indexService (simulates external edit)
        indexFixture.writeFlow(1L, "_flows/late_comer/flow.yaml",
                OfflineFlowIndexServiceTest.scheduledFlow("late_comer", 1L, "1:indexed"));

        OfflineRepoTreeResponse tree = services.treeService.getRepoTree(1L, "group-1", null);
        var children = tree.root().children();
        assertThat(children).hasSize(2);
        assertThat(children).filteredOn(n -> "indexed".equals(n.name())).first()
                .satisfies(node -> {
                    assertThat(node.scheduleState()).isEqualTo("ENABLED");
                    assertThat(node.schedulePeriod()).isEqualTo("DAILY");
                });
        assertThat(children).filteredOn(n -> "late_comer".equals(n.name())).first()
                .satisfies(node -> {
                    assertThat(node.scheduleState()).isEqualTo("ENABLED");
                    assertThat(node.dependencyCount()).isEqualTo(1);
                });
        // Self-healed late_comer into index
        assertThat(indexFixture.flows).extracting(f -> f.getFlowId()).contains("late_comer");
    }

    private List<ProjectGroupContextItem> groups(long... ids) {
        return java.util.Arrays.stream(ids)
                .mapToObj(id -> new ProjectGroupContextItem(id, "group-" + id, "", "GROUP_ADMIN"))
                .toList();
    }

    private static final class TestServices {
        final OfflineFlowContentService contentService;
        final OfflineFlowDependencyService dependencyService;
        final OfflineRepoTreeService treeService;

        TestServices(OfflineFlowIndexServiceTest.InMemoryIndexFixture indexFixture) {
            OfflineKestraFlowFileService mirror = new OfflineKestraFlowFileService(indexFixture.properties);
            this.contentService = new OfflineFlowContentService(
                    indexFixture.properties,
                    indexFixture.repoLockManager,
                    mirror,
                    new OfflineRecentFlowService(null),
                    indexFixture.indexService);
            this.dependencyService = new OfflineFlowDependencyService(
                    indexFixture.properties,
                    contentService,
                    indexFixture.repoLockManager,
                    new PermissionService(),
                    indexFixture.indexService);
            this.treeService = new OfflineRepoTreeService(
                    indexFixture.properties,
                    indexFixture.repoLockManager,
                    mirror,
                    new OfflineRecentFlowService(null),
                    indexFixture.indexService);
        }
    }
}
