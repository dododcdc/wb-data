package com.wbdata.offline.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wbdata.auth.dto.ProjectGroupContextItem;
import com.wbdata.auth.service.PermissionService;
import com.wbdata.datasource.entity.DataSource;
import com.wbdata.datasource.service.DataSourceService;
import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.config.OfflineTransferProperties;
import com.wbdata.offline.dto.NodePosition;
import com.wbdata.offline.dto.OfflineFlowDocumentResponse;
import com.wbdata.offline.dto.RollbackOfflineFlowRequest;
import com.wbdata.offline.dto.RollbackOfflineFlowResponse;
import com.wbdata.offline.dto.SaveOfflineFlowDocumentRequest;
import com.wbdata.offline.dto.SaveOfflineFlowEdgeRequest;
import com.wbdata.offline.dto.SaveOfflineFlowNodeRequest;
import com.wbdata.offline.dto.SaveOfflineFlowStageRequest;
import com.wbdata.offline.enums.OfflineCrossGroupDependency;
import com.wbdata.offline.enums.OfflineFailurePolicy;
import com.wbdata.offline.parameter.dto.FlowParameterBindingRequest;
import com.wbdata.offline.parameter.service.ExecutionParameterSnapshotRegistry;
import com.wbdata.offline.parameter.service.FlowParameterBindingAssembler;
import com.wbdata.offline.parameter.service.FlowParameterSnapshotStore;
import com.wbdata.offline.repo.service.GitCommandService;
import com.wbdata.offline.repo.service.OfflineFlowSnapshotService;
import com.wbdata.offline.repo.service.OfflineGitRemotePort;
import com.wbdata.offline.repo.service.OfflinePublishHistoryPort;
import com.wbdata.offline.repo.service.RepoLockManager;
import com.wbdata.offline.schedule.dto.OfflineFlowDependencyRef;
import com.wbdata.offline.schedule.dto.OfflineFlowDependencySettings;
import com.wbdata.offline.schedule.dto.OfflineFlowSchedule;
import com.wbdata.offline.enums.OfflineSchedulePeriod;
import com.wbdata.offline.transfer.dto.TransferConfig;
import com.wbdata.offline.transfer.dto.TransferEndpointConfig;
import com.wbdata.offline.transfer.dto.TransferFieldMapping;
import com.wbdata.offline.transfer.dto.TransferMappingKind;
import com.wbdata.offline.transfer.dto.TransferWriteMode;
import com.wbdata.offline.transfer.service.TransferConfigFileService;
import com.wbdata.parameter.dto.ParameterDefinitionResponse;
import com.wbdata.parameter.dto.ParameterGroupResponse;
import com.wbdata.parameter.service.ParameterGroupService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.web.server.ResponseStatusException;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class OfflineFlowRollbackServiceTest {

    private static final long GROUP_ID = 1L;
    private static final String FLOW_PATH = "_flows/example/flow.yaml";

    @TempDir
    Path tempDir;

    @Test
    void rollback_restoresHistoricalFilesRemovesStaleFilesAndSyncsKestraWithoutCommitting() throws Exception {
        RollbackFixture f = new RollbackFixture();
        f.registerMysql(10L, GROUP_ID);
        f.registerHive(11L, GROUP_ID);

        TransferConfig transfer = new TransferConfig(
                new TransferEndpointConfig(10L, "MYSQL", "src_db", "orders", null, null, null, null),
                new TransferEndpointConfig(11L, "HIVE", "dw", "dwd_orders", null, TransferWriteMode.APPEND, null, null),
                List.of(new TransferFieldMapping("id", TransferMappingKind.SOURCE_FIELD, "id", null)),
                List.of()
        );
        f.save(GROUP_ID, "example", List.of(
                new SaveOfflineFlowNodeRequest("sql_1", "SELECT 1;", "MYSQL", "scripts/example/sql_1.sql", 10L, "MYSQL"),
                new SaveOfflineFlowNodeRequest("hive_1", "SELECT 2;", "HIVE_SQL", "scripts/example/hive_1.sql", 11L, "HIVE", null, Map.of("hive.exec.dynamic.partition", "true")),
                new SaveOfflineFlowNodeRequest("tx_1", null, "TRANSFER", null, null, null, transfer)
        ), List.of(new SaveOfflineFlowEdgeRequest("sql_1", "tx_1")), Map.of("sql_1", new NodePosition(100, 120)), null, null, null);
        String v1Sha = f.commit(GROUP_ID, "v1");

        // v2 removes hive_1 + tx_1, adds sql_2, changes script content + layout
        f.save(GROUP_ID, "example", List.of(
                new SaveOfflineFlowNodeRequest("sql_1", "SELECT 99;", "MYSQL", "scripts/example/sql_1.sql", 10L, "MYSQL"),
                new SaveOfflineFlowNodeRequest("sql_2", "SELECT 100;", "MYSQL", "scripts/example/sql_2.sql", 10L, "MYSQL")
        ), List.of(), Map.of("sql_2", new NodePosition(300, 200)), null, null, null);
        String v2Sha = f.commit(GROUP_ID, "v2");

        // Uncommitted dirty draft in worktree
        f.save(GROUP_ID, "example", List.of(
                new SaveOfflineFlowNodeRequest("sql_2", "SELECT 999;", "MYSQL", "scripts/example/sql_2.sql", 10L, "MYSQL")
        ), List.of(), Map.of("sql_2", new NodePosition(400, 240)), null, null, null);

        RollbackOfflineFlowResponse response = f.rollback(GROUP_ID, FLOW_PATH, v1Sha);

        assertThat(response.warnings()).isEmpty();
        assertThat(response.nodeIssues()).isEmpty();
        assertThat(response.document().stages().getFirst().nodes())
                .extracting("taskId")
                .containsExactly("sql_1", "hive_1", "tx_1");
        assertThat(response.document().edges()).hasSize(1);
        assertThat(response.document().layout()).containsKey("sql_1");

        Path repo = f.repo(GROUP_ID);
        assertThat(Files.readString(repo.resolve("scripts/example/sql_1.sql"))).isEqualTo("SELECT 1;");
        assertThat(Files.exists(repo.resolve("scripts/example/sql_2.sql"))).isFalse();
        assertThat(repo.resolve("transfers/example/tx_1.transfer.json")).exists();
        assertThat(repo.resolve("_flows/example/.hive-conf.json")).exists();
        assertThat(Files.readString(repo.resolve(".wb-data/kestra-flows/example.yaml")))
                .isEqualTo(Files.readString(repo.resolve(FLOW_PATH)));
        // HEAD remains v2 (no auto-commit)
        assertThat(git(repo, "rev-parse", "HEAD")).isEqualTo(v2Sha);
        assertThat(git(repo, "status", "--porcelain")).isNotBlank();
    }

    @Test
    void rollback_rejectsOptimisticLockMismatchWorktreeInvalidShaAndMissingFlow() throws Exception {
        RollbackFixture f = new RollbackFixture();
        f.save(GROUP_ID, "example", List.of(
                new SaveOfflineFlowNodeRequest("s1", "echo 1", "SHELL", "scripts/example/s1.sh", null, null)
        ), List.of(), Map.of(), null, null, null);
        String v1Sha = f.commit(GROUP_ID, "v1");

        OfflineFlowDocumentResponse current = f.documents.getFlowDocument(GROUP_ID, FLOW_PATH);
        String beforeYaml = Files.readString(f.repo(GROUP_ID).resolve(FLOW_PATH));

        assertThatThrownBy(() -> f.rollbackWithLock(GROUP_ID, FLOW_PATH, v1Sha, "wrong-hash", current.documentUpdatedAt()))
                .isInstanceOfSatisfying(ResponseStatusException.class, ex -> assertThat(ex.getStatusCode().value()).isEqualTo(409));

        assertThatThrownBy(() -> f.rollback(GROUP_ID, FLOW_PATH, "WORKTREE"))
                .isInstanceOfSatisfying(ResponseStatusException.class, ex -> assertThat(ex.getStatusCode().value()).isEqualTo(400));

        assertThatThrownBy(() -> f.rollback(GROUP_ID, FLOW_PATH, "not-a-sha"))
                .isInstanceOfSatisfying(ResponseStatusException.class, ex -> assertThat(ex.getStatusCode().value()).isEqualTo(400));

        assertThatThrownBy(() -> f.rollback(GROUP_ID, FLOW_PATH, "0".repeat(40)))
                .isInstanceOfSatisfying(ResponseStatusException.class, ex -> assertThat(ex.getStatusCode().value()).isEqualTo(404));

        assertThat(Files.readString(f.repo(GROUP_ID).resolve(FLOW_PATH))).isEqualTo(beforeYaml);
    }

    @Test
    void rollback_softRecoversDeletedSqlHiveSqlAndTransferDataSources() throws Exception {
        RollbackFixture f = new RollbackFixture();
        f.registerMysql(10L, GROUP_ID);
        f.registerHive(11L, GROUP_ID);

        TransferConfig transfer = new TransferConfig(
                new TransferEndpointConfig(10L, "MYSQL", "src_db", "orders", null, null, null, null),
                new TransferEndpointConfig(11L, "HIVE", "dw", "dwd_orders", null, TransferWriteMode.APPEND, null, null),
                List.of(new TransferFieldMapping("id", TransferMappingKind.SOURCE_FIELD, "id", null)),
                List.of()
        );
        f.save(GROUP_ID, "example", List.of(
                new SaveOfflineFlowNodeRequest("sql_1", "SELECT 1;", "MYSQL", "scripts/example/sql_1.sql", 10L, "MYSQL"),
                new SaveOfflineFlowNodeRequest("hive_1", "SELECT 2;", "HIVE_SQL", "scripts/example/hive_1.sql", 11L, "HIVE"),
                new SaveOfflineFlowNodeRequest("tx_1", null, "TRANSFER", null, null, null, transfer)
        ), List.of(), Map.of(), null, null, null);
        String v1Sha = f.commit(GROUP_ID, "v1");

        // Later SQL DS 10 is deleted and Hive DS 11 is cross-group (belongs to group 99)
        when(f.dataSourceService.getById(10L)).thenReturn(null);
        f.registerHive(11L, 99L);

        RollbackOfflineFlowResponse response = f.rollback(GROUP_ID, FLOW_PATH, v1Sha);

        var nodes = response.document().stages().getFirst().nodes();
        var sqlNode = nodes.stream().filter(n -> n.taskId().equals("sql_1")).findFirst().orElseThrow();
        var hiveNode = nodes.stream().filter(n -> n.taskId().equals("hive_1")).findFirst().orElseThrow();
        assertThat(sqlNode.dataSourceId()).isNull();
        assertThat(sqlNode.dataSourceType()).isEqualTo("MYSQL");
        assertThat(sqlNode.scriptContent()).isEqualTo("SELECT 1;");
        assertThat(hiveNode.dataSourceId()).isNull();
        assertThat(hiveNode.dataSourceType()).isEqualTo("HIVE");
        assertThat(hiveNode.scriptContent()).isEqualTo("SELECT 2;");

        assertThat(response.nodeIssues()).containsKey("tx_1");
        assertThat(response.nodeIssues().get("tx_1")).contains("数据源");
        assertThat(response.warnings())
                .anyMatch(w -> w.contains("sql_1"))
                .anyMatch(w -> w.contains("hive_1"))
                .anyMatch(w -> w.contains("tx_1"));
        assertThat(f.repo(GROUP_ID).resolve("transfers/example/tx_1.transfer.json")).exists();
    }

    @Test
    void rollback_restoresArchivedMissingAndOutdatedParameterSnapshots() throws Exception {
        RollbackFixture f = new RollbackFixture();
        ParameterGroupResponse groupV1 = new ParameterGroupResponse(
                50L, "biz_date", "业务日期", "", 1, 1, "PUBLISHED",
                1L, 1L, LocalDateTime.now(), LocalDateTime.now(),
                List.of(new ParameterDefinitionResponse(1L, "dt", "CONSTANT", "20261101", null, null, 0, "", 0)));
        when(f.parameterGroupService.get(GROUP_ID, 50L)).thenReturn(groupV1);
        when(f.parameterGroupService.findByCode(GROUP_ID, "biz_date")).thenReturn(Optional.of(groupV1));

        f.save(GROUP_ID, "example", List.of(
                new SaveOfflineFlowNodeRequest("s1", "echo ${dt}", "SHELL", "scripts/example/s1.sh", null, null)
        ), List.of(), Map.of(), null, List.of(new FlowParameterBindingRequest(50L, 1)), null);
        String v1Sha = f.commit(GROUP_ID, "v1");

        // Remove parameter binding in v2
        f.save(GROUP_ID, "example", List.of(
                new SaveOfflineFlowNodeRequest("s1", "echo plain", "SHELL", "scripts/example/s1.sh", null, null)
        ), List.of(), Map.of(), null, List.of(), null);
        f.commit(GROUP_ID, "v2");

        // Case 1: parameter group updated (OUTDATED)
        ParameterGroupResponse groupV2 = new ParameterGroupResponse(
                50L, "biz_date", "业务日期", "", 2, 2, "PUBLISHED",
                1L, 1L, LocalDateTime.now(), LocalDateTime.now(), groupV1.definitions());
        when(f.parameterGroupService.findByCode(GROUP_ID, "biz_date")).thenReturn(Optional.of(groupV2));
        RollbackOfflineFlowResponse outdatedRes = f.rollback(GROUP_ID, FLOW_PATH, v1Sha);
        assertThat(outdatedRes.document().parameterBinding().status()).isEqualTo("OUTDATED");
        assertThat(outdatedRes.document().parameterBinding().definitions()).extracting("key").containsExactly("dt");
        assertThat(outdatedRes.warnings()).anyMatch(w -> w.contains("新版本"));
        assertThat(f.repo(GROUP_ID).resolve("_flows/example/.parameters.json")).exists();

        // Case 2: parameter group archived (ARCHIVED)
        ParameterGroupResponse archived = new ParameterGroupResponse(
                50L, "biz_date", "业务日期", "", 2, 2, "ARCHIVED",
                1L, 1L, LocalDateTime.now(), LocalDateTime.now(), groupV1.definitions());
        when(f.parameterGroupService.findByCode(GROUP_ID, "biz_date")).thenReturn(Optional.of(archived));
        RollbackOfflineFlowResponse archivedRes = f.rollback(GROUP_ID, FLOW_PATH, v1Sha);
        assertThat(archivedRes.document().parameterBinding().status()).isEqualTo("ARCHIVED");
        assertThat(archivedRes.warnings()).anyMatch(w -> w.contains("归档"));

        // Case 3: parameter group deleted (MISSING)
        when(f.parameterGroupService.findByCode(GROUP_ID, "biz_date")).thenReturn(Optional.empty());
        RollbackOfflineFlowResponse missingRes = f.rollback(GROUP_ID, FLOW_PATH, v1Sha);
        assertThat(missingRes.document().parameterBinding().status()).isEqualTo("MISSING");
        assertThat(missingRes.warnings()).anyMatch(w -> w.contains("不存在") || w.contains("快照"));
    }

    @Test
    void rollback_softRecoversMissingUpstreamDependencyAndBlocksDownstreamViolationOrCycle() throws Exception {
        RollbackFixture f = new RollbackFixture();
        OfflineFlowSchedule daily = new OfflineFlowSchedule("0 1 * * *", "Asia/Shanghai", true, OfflineSchedulePeriod.DAILY);
        OfflineFlowSchedule hourly = new OfflineFlowSchedule("0 * * * *", "Asia/Shanghai", true, OfflineSchedulePeriod.HOURLY);

        // Soft recovery: missing upstream in v1 + ordinary save without touching deps succeeds
        f.save(GROUP_ID, "up_old", List.of(node("u1")), List.of(), Map.of(), daily, null, null);
        f.save(GROUP_ID, "example", List.of(node("e1")), List.of(), Map.of(), daily, null,
                new OfflineFlowDependencySettings(List.of(new OfflineFlowDependencyRef(GROUP_ID, "up_old")),
                        OfflineFailurePolicy.CONTINUE, OfflineCrossGroupDependency.ALLOW));
        String v1Sha = f.commit(GROUP_ID, "v1");

        // Remove upstream dependency in v2, then delete up_old from disk
        f.save(GROUP_ID, "example", List.of(node("e1")), List.of(), Map.of(), daily, null,
                new OfflineFlowDependencySettings(List.of(), OfflineFailurePolicy.CONTINUE, OfflineCrossGroupDependency.ALLOW));
        f.commit(GROUP_ID, "v2");
        Files.delete(f.repo(GROUP_ID).resolve("_flows/up_old/flow.yaml"));
        Files.delete(f.repo(GROUP_ID).resolve(".wb-data/kestra-flows/up_old.yaml"));

        RollbackOfflineFlowResponse softRes = f.rollback(GROUP_ID, FLOW_PATH, v1Sha);
        assertThat(softRes.warnings()).anyMatch(w -> w.contains("up_old"));
        assertThat(softRes.document().dependencyConfig().dependencies())
                .containsExactly(new OfflineFlowDependencyRef(GROUP_ID, "up_old"));

        // Ordinary edit (script change only, schedule/deps unchanged) is not blocked by legacy missing upstream
        OfflineFlowDocumentResponse edited = f.saveWithDeps(GROUP_ID, "example", List.of(
                new SaveOfflineFlowNodeRequest("e1", "echo updated", "SHELL", "scripts/example/e1.sh", null, null)
        ), daily, softRes.document().dependencyConfig(), 1L);
        assertThat(edited.stages().getFirst().nodes().getFirst().scriptContent()).isEqualTo("echo updated");

        // Hard block: v1 has HOURLY schedule & DENY crossGroupDependency; later changed to DAILY & ALLOW and downstream in group 2 depends on it
        f.save(GROUP_ID, "target", List.of(node("t1")), List.of(), Map.of(), hourly, null,
                new OfflineFlowDependencySettings(List.of(), OfflineFailurePolicy.CONTINUE, OfflineCrossGroupDependency.DENY));
        String targetHourlyDenySha = f.commit(GROUP_ID, "target v1");

        f.save(GROUP_ID, "target", List.of(node("t1")), List.of(), Map.of(), daily, null,
                new OfflineFlowDependencySettings(List.of(), OfflineFailurePolicy.CONTINUE, OfflineCrossGroupDependency.ALLOW));
        f.commit(GROUP_ID, "target v2");

        f.saveWithDeps(2L, "downstream_g2", List.of(node("d1")), daily,
                new OfflineFlowDependencySettings(List.of(new OfflineFlowDependencyRef(GROUP_ID, "target")), null, null),
                1L, 2L);

        String beforeTargetYaml = Files.readString(f.repo(GROUP_ID).resolve("_flows/target/flow.yaml"));
        assertThatThrownBy(() -> f.rollback(GROUP_ID, "_flows/target/flow.yaml", targetHourlyDenySha))
                .isInstanceOfSatisfying(ResponseStatusException.class, ex -> assertThat(ex.getStatusCode().value()).isEqualTo(422));
        assertThat(Files.readString(f.repo(GROUP_ID).resolve("_flows/target/flow.yaml"))).isEqualTo(beforeTargetYaml);

        // Hard block on cycle: v1 had target -> chain_a while chain_a currently depends on target
        f.save(GROUP_ID, "chain_a", List.of(node("a1")), List.of(), Map.of(), daily, null, null);
        f.save(GROUP_ID, "cycle_flow", List.of(node("c1")), List.of(), Map.of(), daily, null,
                new OfflineFlowDependencySettings(List.of(new OfflineFlowDependencyRef(GROUP_ID, "chain_a")), null, null));
        String cycleV1 = f.commit(GROUP_ID, "cycle v1");

        f.save(GROUP_ID, "cycle_flow", List.of(node("c1")), List.of(), Map.of(), daily, null,
                new OfflineFlowDependencySettings(List.of(), null, null));
        f.commit(GROUP_ID, "cycle v2");

        f.saveWithDeps(GROUP_ID, "chain_a", List.of(node("a1")), daily,
                new OfflineFlowDependencySettings(List.of(new OfflineFlowDependencyRef(GROUP_ID, "cycle_flow")), null, null),
                1L);

        assertThatThrownBy(() -> f.rollback(GROUP_ID, "_flows/cycle_flow/flow.yaml", cycleV1))
                .isInstanceOfSatisfying(ResponseStatusException.class, ex -> {
                    assertThat(ex.getStatusCode().value()).isEqualTo(422);
                    assertThat(ex.getReason()).contains("循环");
                });
    }

    private SaveOfflineFlowNodeRequest node(String taskId) {
        return new SaveOfflineFlowNodeRequest(taskId, "echo " + taskId, "SHELL", "scripts/node/" + taskId + ".sh", null, null);
    }

    private class RollbackFixture {
        final OfflineProperties properties = new OfflineProperties();
        final RepoLockManager locks = new RepoLockManager();
        final DataSourceService dataSourceService = mock(DataSourceService.class);
        final ParameterGroupService parameterGroupService = mock(ParameterGroupService.class);
        final ExecutionParameterSnapshotRegistry snapshotRegistry = mock(ExecutionParameterSnapshotRegistry.class);
        final OfflineFlowDocumentService documents;
        final OfflineFlowContentService content;
        final OfflineFlowDependencyService dependencies;
        final GitCommandService gitCommandService;
        final OfflineFlowSnapshotService snapshots;

        RollbackFixture() throws Exception {
            properties.setRepoBaseDir(tempDir.toString());
            properties.setRepoDirPrefix("wb-data-");
            initRepo(repo(1L));
            initRepo(repo(2L));
            when(snapshotRegistry.register(anyLong(), any())).thenReturn("snap-1");
            OfflineKestraFlowFileService kestra = new OfflineKestraFlowFileService(properties);
            FlowParameterSnapshotStore snapshotStore = new FlowParameterSnapshotStore(new ObjectMapper());
            TransferConfigFileService transferService = new TransferConfigFileService(new ObjectMapper());
            content = new OfflineFlowContentService(properties, locks, kestra);
            documents = new OfflineFlowDocumentService(
                    properties,
                    content,
                    locks,
                    kestra,
                    transferService,
                    snapshotStore,
                    new FlowParameterBindingAssembler(parameterGroupService, snapshotStore),
                    new FlowGraphDraftBuilder(dataSourceService, transferService),
                    snapshotRegistry,
                    new OfflineTransferProperties()
            );
            dependencies = new OfflineFlowDependencyService(properties, content, locks, new PermissionService());
            gitCommandService = new GitCommandService(
                    properties, mock(OfflineGitRemotePort.class), documents, mock(OfflinePublishHistoryPort.class), locks);
            snapshots = new OfflineFlowSnapshotService(documents, gitCommandService, properties);
        }

        Path repo(long groupId) {
            return properties.resolveRepoPath(groupId);
        }

        void registerMysql(long id, long groupId) {
            DataSource ds = new DataSource();
            ds.setId(id);
            ds.setGroupId(groupId);
            ds.setType("MYSQL");
            ds.setHost("127.0.0.1");
            ds.setPort(3306);
            ds.setDatabaseName("src_db");
            ds.setUsername("u");
            ds.setPassword("p");
            when(dataSourceService.getById(id)).thenReturn(ds);
        }

        void registerHive(long id, long groupId) {
            DataSource ds = new DataSource();
            ds.setId(id);
            ds.setGroupId(groupId);
            ds.setType("HIVE");
            ds.setHost("127.0.0.1");
            ds.setPort(10000);
            ds.setDatabaseName("dw");
            ds.setUsername("hive");
            ds.setPassword("p");
            when(dataSourceService.getById(id)).thenReturn(ds);
        }

        OfflineFlowDocumentResponse save(long groupId,
                                         String flowName,
                                         List<SaveOfflineFlowNodeRequest> nodes,
                                         List<SaveOfflineFlowEdgeRequest> edges,
                                         Map<String, NodePosition> layout,
                                         OfflineFlowSchedule schedule,
                                         List<FlowParameterBindingRequest> parameterBindings,
                                         OfflineFlowDependencySettings dependencyConfig) {
            SaveOfflineFlowDocumentRequest req = new SaveOfflineFlowDocumentRequest(
                    groupId,
                    "_flows/" + flowName + "/flow.yaml",
                    null,
                    0L,
                    List.of(new SaveOfflineFlowStageRequest("main", nodes)),
                    edges,
                    layout,
                    schedule,
                    null,
                    parameterBindings,
                    "Asia/Shanghai",
                    dependencyConfig
            );
            return dependencies.saveDocument(req, groups(groupId), () -> documents.saveFlowDocument(req));
        }

        OfflineFlowDocumentResponse saveWithDeps(long groupId,
                                                 String flowName,
                                                 List<SaveOfflineFlowNodeRequest> nodes,
                                                 OfflineFlowSchedule schedule,
                                                 OfflineFlowDependencySettings dependencyConfig,
                                                 long... accessible) {
            SaveOfflineFlowDocumentRequest req = new SaveOfflineFlowDocumentRequest(
                    groupId,
                    "_flows/" + flowName + "/flow.yaml",
                    null,
                    0L,
                    List.of(new SaveOfflineFlowStageRequest("main", nodes)),
                    List.of(),
                    Map.of(),
                    schedule,
                    null,
                    null,
                    "Asia/Shanghai",
                    dependencyConfig
            );
            return dependencies.saveDocument(req, groups(accessible), () -> documents.saveFlowDocument(req));
        }

        RollbackOfflineFlowResponse rollback(long groupId, String path, String revision) {
            OfflineFlowDocumentResponse current = documents.getFlowDocument(groupId, path);
            return rollbackWithLock(groupId, path, revision, current.documentHash(), current.documentUpdatedAt());
        }

        RollbackOfflineFlowResponse rollbackWithLock(long groupId,
                                                     String path,
                                                     String revision,
                                                     String hash,
                                                     Long updatedAt) {
            RollbackOfflineFlowRequest request = new RollbackOfflineFlowRequest(groupId, path, revision, hash, updatedAt);
            return dependencies.rollbackDocument(
                    groupId, path, groups(1L, 2L), validator -> snapshots.rollbackFlow(request, validator));
        }

        String commit(long groupId, String message) throws Exception {
            Path r = repo(groupId);
            git(r, "add", "-A");
            git(r, "commit", "-m", message);
            return git(r, "rev-parse", "HEAD");
        }

        List<ProjectGroupContextItem> groups(long... ids) {
            return java.util.Arrays.stream(ids)
                    .mapToObj(id -> new ProjectGroupContextItem(id, "group-" + id, "", "GROUP_ADMIN"))
                    .toList();
        }
    }

    private static void initRepo(Path repo) throws Exception {
        Files.createDirectories(repo);
        git(repo, "init", "-b", "main");
        git(repo, "config", "user.name", "WB Test");
        git(repo, "config", "user.email", "wb@example.com");
    }

    private static String git(Path repo, String... args) throws Exception {
        List<String> command = new ArrayList<>();
        command.add("git");
        command.add("-C");
        command.add(repo.toString());
        command.addAll(List.of(args));
        Process process = new ProcessBuilder(command).redirectErrorStream(true).start();
        int exitCode = process.waitFor();
        String output = new String(process.getInputStream().readAllBytes());
        if (exitCode != 0) {
            throw new IllegalStateException(output);
        }
        return output.trim();
    }
}
