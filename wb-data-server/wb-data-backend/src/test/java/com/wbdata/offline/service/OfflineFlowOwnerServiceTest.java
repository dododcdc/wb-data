package com.wbdata.offline.service;

import com.wbdata.auth.context.GroupAuthContext;
import com.wbdata.auth.service.AuthSession;
import com.wbdata.group.dto.AssetOwnerSummaryResponse;
import com.wbdata.group.dto.GroupOwnerInfo;
import com.wbdata.group.dto.TransferOwnerResponse;
import com.wbdata.group.service.GroupOwnerService;
import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.dto.TransferOfflineFlowOwnerRequest;
import com.wbdata.offline.entity.WbOfflineFlowIndex;
import com.wbdata.offline.repo.service.GitWorktreeManager;
import com.wbdata.offline.repo.service.RepoLockManager;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class OfflineFlowOwnerServiceTest {

    @TempDir
    Path tempDir;

    @Test
    void listAndTransferFlowsByPathAndByOwnerEnforcePermissionsAndSyncIndex() throws Exception {
        OfflineProperties props = new OfflineProperties();
        props.setRepoBaseDir(tempDir.toString());
        props.setRepoDirPrefix("group-");
        Path repoPath = tempDir.resolve("group-1");
        Path flowAPath = repoPath.resolve("_flows/a/flow.yaml");
        Path flowBPath = repoPath.resolve("_flows/b/flow.yaml");
        Files.createDirectories(flowAPath.getParent());
        Files.createDirectories(flowBPath.getParent());
        Files.writeString(flowAPath, """
                id: a
                namespace: pg-1
                labels:
                  wbdataOwnerUserId: '10'
                tasks: []
                """, StandardCharsets.UTF_8);
        Files.writeString(flowBPath, """
                id: b
                namespace: pg-1
                labels:
                  wbdataOwnerUserId: '10'
                tasks: []
                """, StandardCharsets.UTF_8);

        RepoLockManager lockManager = new RepoLockManager();
        OfflineKestraFlowFileService kestraFlowFileService = mock(OfflineKestraFlowFileService.class);
        OfflineFlowIndexService indexService = mock(OfflineFlowIndexService.class);
        GroupOwnerService groupOwnerService = mock(GroupOwnerService.class);

        WbOfflineFlowIndex rowA = new WbOfflineFlowIndex();
        rowA.setGroupId(1L);
        rowA.setFlowPath("_flows/a/flow.yaml");
        rowA.setFlowId("a");
        rowA.setOwnerUserId(10L);

        WbOfflineFlowIndex rowB = new WbOfflineFlowIndex();
        rowB.setGroupId(1L);
        rowB.setFlowPath("_flows/b/flow.yaml");
        rowB.setFlowId("b");
        rowB.setOwnerUserId(10L);

        when(indexService.listGroupFlowMap(1L)).thenReturn(Map.of(
                "_flows/a/flow.yaml", rowA,
                "_flows/b/flow.yaml", rowB
        ));
        when(groupOwnerService.summarizeOwners(1L, Map.of(10L, 2L)))
                .thenReturn(List.of(new AssetOwnerSummaryResponse(10L, "alice", "Alice", "ACTIVE", 2L)));

        OfflineFlowOwnerService service = new OfflineFlowOwnerService(
                props, lockManager, kestraFlowFileService, indexService, groupOwnerService);

        List<AssetOwnerSummaryResponse> owners = service.listFlowOwners(1L);
        assertThat(owners).hasSize(1);
        assertThat(owners.getFirst().count()).isEqualTo(2L);

        // Developer (user 20) cannot transfer user 10's flow
        GroupAuthContext otherDev = new GroupAuthContext(
                new AuthSession(20L, "bob", "Bob", "USER", Instant.now()), 1L, "Alpha");
        when(groupOwnerService.requireAssignableOwner(1L, 30L))
                .thenReturn(new GroupOwnerInfo(30L, "charlie", "Charlie", "ACTIVE"));
        when(groupOwnerService.canManageOthersOwnership(1L, 20L)).thenReturn(false);

        assertThatThrownBy(() -> service.transferFlowOwners(
                1L, new TransferOfflineFlowOwnerRequest(List.of("_flows/a/flow.yaml"), null, 30L), otherDev))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("仅负责人本人或项目组管理员");

        // Owner (user 10) can transfer own single flow
        GroupAuthContext ownerCtx = new GroupAuthContext(
                new AuthSession(10L, "alice", "Alice", "USER", Instant.now()), 1L, "Alpha");
        when(groupOwnerService.canManageOthersOwnership(1L, 10L)).thenReturn(false);

        TransferOwnerResponse singleRes = service.transferFlowOwners(
                1L, new TransferOfflineFlowOwnerRequest(List.of("_flows/a/flow.yaml"), null, 30L), ownerCtx);
        assertThat(singleRes.updatedCount()).isEqualTo(1);
        assertThat(new OfflineFlowYamlSupport().readOwnerUserId(Files.readString(flowAPath))).isEqualTo(30L);
        verify(kestraFlowFileService).syncFlowFile(repoPath, "_flows/a/flow.yaml");
        verify(indexService).onFlowSaved(eq(1L), eq("_flows/a/flow.yaml"), any(), eq(flowAPath));

        // Admin bulk transfer remaining flow B from 10 -> 30
        GroupAuthContext adminCtx = new GroupAuthContext(
                new AuthSession(99L, "admin", "Admin", "SYSTEM_ADMIN", Instant.now()), 1L, "Alpha");
        when(groupOwnerService.canManageOthersOwnership(1L, 99L)).thenReturn(true);
        when(indexService.listFlowsByGroupAndOwner(1L, 10L)).thenReturn(List.of(rowB));

        TransferOwnerResponse bulkRes = service.transferFlowOwners(
                1L, new TransferOfflineFlowOwnerRequest(null, 10L, 30L), adminCtx);
        assertThat(bulkRes.updatedCount()).isEqualTo(1);
        assertThat(new OfflineFlowYamlSupport().readOwnerUserId(Files.readString(flowBPath))).isEqualTo(30L);
    }

    @Test
    void transferAllFromOwnerInternalSyncsAcrossAllActiveWorktrees() throws Exception {
        OfflineProperties props = new OfflineProperties();
        props.setRepoBaseDir(tempDir.toString());
        props.setRepoDirPrefix("group-");
        Path mainRepoPath = tempDir.resolve("group-1");
        Path featureRepoPath = tempDir.resolve("group-1-worktrees/feature-a");
        Path mainFlowPath = mainRepoPath.resolve("_flows/shared/flow.yaml");
        Path featureFlowPath = featureRepoPath.resolve("_flows/shared/flow.yaml");
        Path onlyFeatureFlowPath = featureRepoPath.resolve("_flows/only_feature/flow.yaml");
        Files.createDirectories(mainFlowPath.getParent());
        Files.createDirectories(featureFlowPath.getParent());
        Files.createDirectories(onlyFeatureFlowPath.getParent());

        String yamlOwner10 = """
                id: %s
                namespace: pg-1
                labels:
                  wbdataOwnerUserId: '10'
                tasks: []
                """;
        Files.writeString(mainFlowPath, yamlOwner10.formatted("shared"), StandardCharsets.UTF_8);
        Files.writeString(featureFlowPath, yamlOwner10.formatted("shared"), StandardCharsets.UTF_8);
        Files.writeString(onlyFeatureFlowPath, yamlOwner10.formatted("only_feature"), StandardCharsets.UTF_8);

        RepoLockManager lockManager = new RepoLockManager();
        OfflineKestraFlowFileService kestraFlowFileService = mock(OfflineKestraFlowFileService.class);
        OfflineFlowIndexService indexService = mock(OfflineFlowIndexService.class);
        GroupOwnerService groupOwnerService = mock(GroupOwnerService.class);
        GitWorktreeManager worktreeManager = mock(GitWorktreeManager.class);

        when(worktreeManager.listActiveWorktrees(1L)).thenReturn(List.of(
                new GitWorktreeManager.WorktreeInfo("main", mainRepoPath, true),
                new GitWorktreeManager.WorktreeInfo("feature/a", featureRepoPath, false)
        ));

        WbOfflineFlowIndex mainShared = new WbOfflineFlowIndex();
        mainShared.setGroupId(1L);
        mainShared.setBranch("main");
        mainShared.setFlowPath("_flows/shared/flow.yaml");
        mainShared.setFlowId("shared");
        mainShared.setOwnerUserId(10L);

        WbOfflineFlowIndex featureShared = new WbOfflineFlowIndex();
        featureShared.setGroupId(1L);
        featureShared.setBranch("feature/a");
        featureShared.setFlowPath("_flows/shared/flow.yaml");
        featureShared.setFlowId("shared");
        featureShared.setOwnerUserId(10L);

        WbOfflineFlowIndex featureOnly = new WbOfflineFlowIndex();
        featureOnly.setGroupId(1L);
        featureOnly.setBranch("feature/a");
        featureOnly.setFlowPath("_flows/only_feature/flow.yaml");
        featureOnly.setFlowId("only_feature");
        featureOnly.setOwnerUserId(10L);

        when(groupOwnerService.requireAssignableOwner(1L, 30L))
                .thenReturn(new GroupOwnerInfo(30L, "charlie", "Charlie", "ACTIVE"));
        when(indexService.listFlowsByGroupAndOwner(1L, 10L)).thenAnswer(invocation ->
                "feature/a".equals(com.wbdata.offline.config.OfflineBranchContext.currentBranch(1L))
                        ? List.of(featureShared, featureOnly)
                        : List.of(mainShared));

        OfflineFlowOwnerService service = new OfflineFlowOwnerService(
                props, lockManager, kestraFlowFileService, indexService, groupOwnerService);
        service.setGitWorktreeManager(worktreeManager);

        TransferOwnerResponse res = service.transferAllFromOwnerInternal(1L, 10L, 30L);

        assertThat(res.updatedCount()).isEqualTo(2);
        assertThat(res.targetOwnerName()).isEqualTo("Charlie");
        assertThat(new OfflineFlowYamlSupport().readOwnerUserId(Files.readString(mainFlowPath))).isEqualTo(30L);
        assertThat(new OfflineFlowYamlSupport().readOwnerUserId(Files.readString(featureFlowPath))).isEqualTo(30L);
        assertThat(new OfflineFlowYamlSupport().readOwnerUserId(Files.readString(onlyFeatureFlowPath))).isEqualTo(30L);
        verify(kestraFlowFileService).syncFlowFile(mainRepoPath, "_flows/shared/flow.yaml");
        verify(kestraFlowFileService).syncFlowFile(featureRepoPath, "_flows/shared/flow.yaml");
        verify(kestraFlowFileService).syncFlowFile(featureRepoPath, "_flows/only_feature/flow.yaml");
        verify(indexService).onFlowSaved(eq(1L), eq("_flows/shared/flow.yaml"), any(), eq(mainFlowPath));
        verify(indexService).onFlowSaved(eq(1L), eq("_flows/shared/flow.yaml"), any(), eq(featureFlowPath));
        verify(indexService).onFlowSaved(eq(1L), eq("_flows/only_feature/flow.yaml"), any(), eq(onlyFeatureFlowPath));
    }
}
