package com.wbdata.offline.service;

import com.wbdata.group.entity.WbProjectGroup;
import com.wbdata.group.mapper.WbProjectGroupMapper;
import com.wbdata.offline.config.OfflineBranchContext;
import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.entity.WbOfflineFlowDependency;
import com.wbdata.offline.entity.WbOfflineFlowIndex;
import com.wbdata.offline.entity.WbOfflineRepoIndexState;
import com.wbdata.offline.enums.OfflineSchedulePeriod;
import com.wbdata.offline.mapper.WbOfflineFlowDependencyMapper;
import com.wbdata.offline.mapper.WbOfflineFlowIndexMapper;
import com.wbdata.offline.mapper.WbOfflineRepoIndexStateMapper;
import com.wbdata.offline.repo.service.RepoLockManager;
import com.wbdata.offline.schedule.dto.OfflineFlowDependencyRef;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.io.Serializable;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class OfflineFlowIndexServiceTest {

    @TempDir
    Path tempDir;

    @Test
    void writeThroughTracksSaveMoveDeleteAndFolderOperationsWithoutPrefixCollisions() throws Exception {
        InMemoryIndexFixture fixture = new InMemoryIndexFixture(tempDir, true);
        OfflineFlowIndexService indexService = fixture.indexService;

        Path flowA = fixture.writeFlow(1L, "_flows/a/flow.yaml", scheduledFlow("flow_a", 1L, ""));
        Path flowAb = fixture.writeFlow(1L, "_flows/ab/flow.yaml", scheduledFlow("flow_ab", 1L, "1:flow_a"));
        indexService.onFlowSaved(1L, "_flows/a/flow.yaml", Files.readString(flowA), flowA);
        indexService.onFlowSaved(1L, "_flows/ab/flow.yaml", Files.readString(flowAb), flowAb);

        assertThat(indexService.findDirectDependents(new OfflineFlowDependencyRef(1L, "flow_a")))
                .extracting(OfflineFlowIndexService.IndexedFlowSnapshot::flowId)
                .containsExactly("flow_ab");

        // Deleting folder _flows/a must NOT remove _flows/ab (prefix underscore safe)
        indexService.onFolderDeleted(1L, "_flows/a");
        assertThat(fixture.flows).hasSize(1);
        assertThat(fixture.flows.getFirst().getFlowPath()).isEqualTo("_flows/ab/flow.yaml");

        // Moving folder _flows/ab -> _flows/archive/ab preserves edge and rewrites flowPath
        Path movedAb = fixture.writeFlow(1L, "_flows/archive/ab/flow.yaml", Files.readString(flowAb));
        indexService.onFolderMoved(1L, "_flows/ab", "_flows/archive/ab", fixture.repo(1L));
        assertThat(fixture.flows).hasSize(1);
        assertThat(fixture.flows.getFirst().getFlowPath()).isEqualTo("_flows/archive/ab/flow.yaml");
        assertThat(movedAb).isRegularFile();

        // Single flow move & delete
        Path renamedAb = fixture.writeFlow(1L, "_flows/archive/ab_v2/flow.yaml", Files.readString(movedAb));
        indexService.onFlowMoved(1L, "_flows/archive/ab/flow.yaml", "_flows/archive/ab_v2/flow.yaml", renamedAb);
        assertThat(fixture.flows.getFirst().getFlowPath()).isEqualTo("_flows/archive/ab_v2/flow.yaml");

        indexService.onFlowDeleted(1L, "_flows/archive/ab_v2/flow.yaml");
        assertThat(fixture.flows).isEmpty();
        assertThat(fixture.dependencies).isEmpty();
    }

    @Test
    void reconcileGroupSkipsUnchangedFilesByMtimeAndSizeMarksInvalidAndCleansDeleted() throws Exception {
        InMemoryIndexFixture fixture = new InMemoryIndexFixture(tempDir, true);
        OfflineFlowIndexService indexService = fixture.indexService;

        String validYaml = scheduledFlow("task_1", 1L, "");
        Path flow1 = fixture.writeFlow(1L, "_flows/task_1/flow.yaml", validYaml);
        Path flow2 = fixture.writeFlow(1L, "_flows/task_2/flow.yaml", scheduledFlow("task_2", 1L, "1:task_1"));

        indexService.reconcileGroup(1L);
        assertThat(fixture.flows).hasSize(2);
        assertThat(fixture.states).hasSize(1);
        assertThat(fixture.states.getFirst().getFlowCount()).isEqualTo(2);

        // Rewrite flow1 with same byte length and restore original mtime -> reconcile must skip parsing it
        FileTime originalMtime = Files.getLastModifiedTime(flow1);
        byte[] badSameLen = " ".repeat(validYaml.getBytes().length).getBytes();
        Files.write(flow1, badSameLen);
        Files.setLastModifiedTime(flow1, originalMtime);
        Files.delete(flow2);

        indexService.reconcileGroup(1L);
        assertThat(fixture.flows).hasSize(1);
        assertThat(fixture.flows.getFirst().getParseStatus()).isEqualTo(OfflineFlowIndexService.PARSE_STATUS_OK);

        // Now write malformed YAML with new size/mtime -> reconcile must parse and mark INVALID
        Files.writeString(flow1, ":::not_valid_yaml");
        indexService.reconcileGroup(1L);
        assertThat(fixture.flows.getFirst().getParseStatus()).isEqualTo(OfflineFlowIndexService.PARSE_STATUS_INVALID);

        assertThatThrownBy(indexService::assertGraphHealthy)
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getStatusCode().value()).isEqualTo(422))
                .hasMessageContaining("无法读取完整任务依赖图");
    }

    @Test
    void createsCycleDetectsMultiHopCrossGroupCyclesViaBfs() throws Exception {
        InMemoryIndexFixture fixture = new InMemoryIndexFixture(tempDir, true);
        OfflineFlowIndexService indexService = fixture.indexService;

        Path a = fixture.writeFlow(1L, "_flows/a/flow.yaml", scheduledFlow("a", 1L, ""));
        Path b = fixture.writeFlow(2L, "_flows/b/flow.yaml", scheduledFlow("b", 2L, "1:a"));
        Path c = fixture.writeFlow(3L, "_flows/c/flow.yaml", scheduledFlow("c", 3L, "2:b"));
        indexService.onFlowSaved(1L, "_flows/a/flow.yaml", Files.readString(a), a);
        indexService.onFlowSaved(2L, "_flows/b/flow.yaml", Files.readString(b), b);
        indexService.onFlowSaved(3L, "_flows/c/flow.yaml", Files.readString(c), c);
        indexService.reconcileAllExistingGroupsAtStartup();

        assertThat(indexService.createsCycle(
                new OfflineFlowDependencyRef(1L, "a"),
                List.of(new OfflineFlowDependencyRef(3L, "c")))).isTrue();
        assertThat(indexService.createsCycle(
                new OfflineFlowDependencyRef(3L, "c"),
                List.of(new OfflineFlowDependencyRef(1L, "a")))).isFalse();
    }

    @Test
    void findExternalDependentsOfFolderIgnoresInternalEdgesAndReturnsExternalDownstreams() throws Exception {
        InMemoryIndexFixture fixture = new InMemoryIndexFixture(tempDir, true);
        OfflineFlowIndexService indexService = fixture.indexService;

        fixture.writeFlow(1L, "_flows/dir/a/flow.yaml", scheduledFlow("a", 1L, ""));
        fixture.writeFlow(1L, "_flows/dir/b/flow.yaml", scheduledFlow("b", 1L, "1:a"));
        fixture.writeFlow(1L, "_flows/other/c/flow.yaml", scheduledFlow("c", 1L, "1:a"));
        fixture.writeFlow(2L, "_flows/ext/d/flow.yaml", scheduledFlow("d", 2L, "1:b"));
        indexService.reconcileAllExistingGroupsAtStartup();

        List<OfflineFlowIndexService.IndexedFlowSnapshot> external =
                indexService.findExternalDependentsOfFolder(1L, "_flows/dir");

        assertThat(external)
                .extracting(OfflineFlowIndexService.IndexedFlowSnapshot::flowId)
                .containsExactlyInAnyOrder("c", "d");
    }

    @Test
    void dbFailureMarksGroupDirtyAndSelfHealsOnNextReadOrValidation() throws Exception {
        InMemoryIndexFixture fixture = new InMemoryIndexFixture(tempDir, true);
        OfflineFlowIndexService indexService = fixture.indexService;

        Path f1 = fixture.writeFlow(1L, "_flows/f1/flow.yaml", scheduledFlow("f1", 1L, ""));
        indexService.reconcileAllExistingGroupsAtStartup();

        fixture.failNextWrite.set(true);
        Path f2 = fixture.writeFlow(1L, "_flows/f2/flow.yaml", scheduledFlow("f2", 1L, "1:f1"));
        indexService.onFlowSaved(1L, "_flows/f2/flow.yaml", Files.readString(f2), f2);

        // Despite earlier DB error, flow_f2 was not persisted yet; next call must self-heal from disk
        assertThat(fixture.flows).hasSize(1);
        assertThat(f1).isRegularFile();

        indexService.assertGraphHealthy();
        assertThat(fixture.flows).hasSize(2);
        assertThat(indexService.findDirectDependents(new OfflineFlowDependencyRef(1L, "f1")))
                .extracting(OfflineFlowIndexService.IndexedFlowSnapshot::flowId)
                .containsExactly("f2");
    }

    @Test
    void skipsOrphanDiskRepositoryWhenProjectGroupNotInDatabase() throws Exception {
        InMemoryIndexFixture fixture = new InMemoryIndexFixture(tempDir, false);
        fixture.existingGroupIds.add(1L);
        fixture.writeFlow(1L, "_flows/valid/flow.yaml", scheduledFlow("valid", 1L, ""));
        fixture.writeFlow(999L, "_flows/orphan/flow.yaml", scheduledFlow("orphan", 999L, ""));

        fixture.indexService.reconcileAllExistingGroupsAtStartup();
        fixture.indexService.reconcileGroup(999L);

        assertThat(fixture.flows).extracting(WbOfflineFlowIndex::getGroupId).containsOnly(1L);
        assertThat(fixture.states).extracting(WbOfflineRepoIndexState::getGroupId).containsOnly(1L);
    }

    @Test
    void isolatesIndexRowsPerBranchAndCleansDeletedBranch() throws Exception {
        InMemoryIndexFixture fixture = new InMemoryIndexFixture(tempDir, true);
        OfflineFlowIndexService indexService = fixture.indexService;

        Path mainFlow = fixture.writeFlow(1L, "_flows/example/flow.yaml",
                scheduledFlow("example", 1L, "") + "  wbdataOwnerUserId: '10'\n");
        indexService.onFlowSaved(1L, "_flows/example/flow.yaml", Files.readString(mainFlow), mainFlow);

        Path featureWt = tempDir.resolve("wb-data-1-worktrees/feature-a");
        Path featureExample = featureWt.resolve("_flows/example/flow.yaml");
        Path featureOnly = featureWt.resolve("_flows/only_feature/flow.yaml");
        Files.createDirectories(featureExample.getParent());
        Files.createDirectories(featureOnly.getParent());
        Files.writeString(featureExample, scheduledFlow("example", 1L, "") + "  wbdataOwnerUserId: '20'\n");
        Files.writeString(featureOnly, scheduledFlow("only_feature", 1L, "") + "  wbdataOwnerUserId: '20'\n");

        OfflineBranchContext.withWorkspace(1L, "feature/a", featureWt, () -> {
            try {
                indexService.onFlowSaved(1L, "_flows/example/flow.yaml", Files.readString(featureExample), featureExample);
                indexService.onFlowSaved(1L, "_flows/only_feature/flow.yaml", Files.readString(featureOnly), featureOnly);
            } catch (IOException ex) {
                throw new RuntimeException(ex);
            }
            Map<String, WbOfflineFlowIndex> featureMap = indexService.listGroupFlowMap(1L);
            assertThat(featureMap.keySet()).containsExactlyInAnyOrder("_flows/example/flow.yaml", "_flows/only_feature/flow.yaml");
            assertThat(featureMap.get("_flows/example/flow.yaml").getOwnerUserId()).isEqualTo(20L);
        });

        Map<String, WbOfflineFlowIndex> mainMap = indexService.listGroupFlowMap(1L);
        assertThat(mainMap.keySet()).containsExactly("_flows/example/flow.yaml");
        assertThat(mainMap.get("_flows/example/flow.yaml").getOwnerUserId()).isEqualTo(10L);

        Map<String, Long> owners = indexService.findFlowOwnersByGroupAndBranches(1L, Map.of(
                "main", Set.of("example"),
                "feature/a", Set.of("example", "only_feature")
        ));
        assertThat(owners).containsEntry("main::example", 10L);
        assertThat(owners).containsEntry("feature/a::example", 20L);
        assertThat(owners).containsEntry("feature/a::only_feature", 20L);

        indexService.onBranchDeleted(1L, "feature/a");
        assertThat(fixture.flows).extracting(WbOfflineFlowIndex::getBranch).containsOnly("main");
    }

    static String scheduledFlow(String flowId, long groupId, String dependenciesLabel) {
        StringBuilder sb = new StringBuilder();
        sb.append("id: ").append(flowId).append('\n')
                .append("namespace: pg-").append(groupId).append('\n')
                .append("tasks: []\n")
                .append("triggers:\n")
                .append("  - id: schedule\n")
                .append("    type: io.kestra.plugin.core.trigger.Schedule\n")
                .append("    cron: \"0 1 * * *\"\n")
                .append("labels:\n")
                .append("  wbdataSchedulePeriod: ").append(OfflineSchedulePeriod.DAILY.name()).append('\n');
        if (dependenciesLabel != null && !dependenciesLabel.isBlank()) {
            sb.append("  wbdataDependencies: \"").append(dependenciesLabel).append("\"\n");
        }
        return sb.toString();
    }

    static final class InMemoryIndexFixture {
        final OfflineProperties properties = new OfflineProperties();
        final RepoLockManager repoLockManager = new RepoLockManager();
        final List<WbOfflineFlowIndex> flows = new ArrayList<>();
        final List<WbOfflineFlowDependency> dependencies = new ArrayList<>();
        final List<WbOfflineRepoIndexState> states = new ArrayList<>();
        final Set<Long> existingGroupIds = java.util.concurrent.ConcurrentHashMap.newKeySet();
        final AtomicBoolean failNextWrite = new AtomicBoolean(false);
        final OfflineFlowIndexService indexService;

        private final AtomicLong flowSeq = new AtomicLong(1L);
        private final AtomicLong depSeq = new AtomicLong(1L);

        InMemoryIndexFixture(Path tempDir, boolean disableGroupFilter) {
            properties.setRepoBaseDir(tempDir.toString());
            properties.setRepoDirPrefix("wb-data-");

            WbOfflineFlowIndexMapper indexMapper = createIndexMapper();
            WbOfflineFlowDependencyMapper depMapper = createDepMapper();
            WbOfflineRepoIndexStateMapper stateMapper = createStateMapper();
            WbProjectGroupMapper groupMapper = disableGroupFilter ? null : createGroupMapper();

            this.indexService = new OfflineFlowIndexService(
                    properties, repoLockManager, indexMapper, depMapper, stateMapper, null, groupMapper);
        }

        Path repo(long groupId) {
            return properties.resolveRepoPath(groupId);
        }

        Path writeFlow(long groupId, String relativePath, String content) throws IOException {
            Path file = repo(groupId).resolve(relativePath);
            Files.createDirectories(file.getParent());
            return Files.writeString(file, content);
        }

        private void maybeFailWrite() {
            if (failNextWrite.compareAndSet(true, false)) {
                throw new IllegalStateException("simulated db failure");
            }
        }

        private WbProjectGroupMapper createGroupMapper() {
            WbProjectGroupMapper mapper = mock(WbProjectGroupMapper.class);
            when(mapper.selectById(any(Serializable.class))).thenAnswer(inv -> {
                Long id = ((Number) inv.getArgument(0)).longValue();
                if (!existingGroupIds.contains(id)) {
                    return null;
                }
                WbProjectGroup group = new WbProjectGroup();
                group.setId(id);
                return group;
            });
            when(mapper.selectList(any())).thenAnswer(inv -> existingGroupIds.stream().map(id -> {
                WbProjectGroup group = new WbProjectGroup();
                group.setId(id);
                return group;
            }).toList());
            return mapper;
        }

        private synchronized WbOfflineFlowIndex copyFlow(WbOfflineFlowIndex src) {
            WbOfflineFlowIndex copy = new WbOfflineFlowIndex();
            copy.setId(src.getId());
            copy.setGroupId(src.getGroupId());
            copy.setBranch(src.getBranch());
            copy.setFlowPath(src.getFlowPath());
            copy.setFlowId(src.getFlowId());
            copy.setOwnerUserId(src.getOwnerUserId());
            copy.setParseStatus(src.getParseStatus());
            copy.setHasSchedule(src.getHasSchedule());
            copy.setScheduleEnabled(src.getScheduleEnabled());
            copy.setSchedulePeriod(src.getSchedulePeriod());
            copy.setScheduleCron(src.getScheduleCron());
            copy.setScheduleTimezone(src.getScheduleTimezone());
            copy.setCrossGroupDependency(src.getCrossGroupDependency());
            copy.setFailurePolicy(src.getFailurePolicy());
            copy.setDependencyCount(src.getDependencyCount());
            copy.setFileMtimeMs(src.getFileMtimeMs());
            copy.setFileSize(src.getFileSize());
            copy.setUpdatedAt(src.getUpdatedAt());
            return copy;
        }

        private WbOfflineFlowIndexMapper createIndexMapper() {
            WbOfflineFlowIndexMapper mapper = mock(WbOfflineFlowIndexMapper.class);
            when(mapper.findByGroup(anyLong())).thenAnswer(inv -> {
                Long gid = inv.getArgument(0);
                synchronized (InMemoryIndexFixture.this) {
                    return flows.stream().filter(f -> gid.equals(f.getGroupId())).map(this::copyFlow).toList();
                }
            });
            when(mapper.findByGroupAndBranch(anyLong(), anyString())).thenAnswer(inv -> {
                Long gid = inv.getArgument(0);
                String branch = inv.getArgument(1);
                synchronized (InMemoryIndexFixture.this) {
                    return flows.stream()
                            .filter(f -> gid.equals(f.getGroupId()) && branch.equals(f.getBranch()))
                            .map(this::copyFlow).toList();
                }
            });
            when(mapper.findByGroupAndPath(anyLong(), anyString())).thenAnswer(inv -> {
                Long gid = inv.getArgument(0);
                String path = inv.getArgument(1);
                synchronized (InMemoryIndexFixture.this) {
                    return flows.stream()
                            .filter(f -> gid.equals(f.getGroupId()) && path.equals(f.getFlowPath()))
                            .findFirst().map(this::copyFlow).orElse(null);
                }
            });
            when(mapper.findByGroupAndBranchAndPath(anyLong(), anyString(), anyString())).thenAnswer(inv -> {
                Long gid = inv.getArgument(0);
                String branch = inv.getArgument(1);
                String path = inv.getArgument(2);
                synchronized (InMemoryIndexFixture.this) {
                    return flows.stream()
                            .filter(f -> gid.equals(f.getGroupId()) && branch.equals(f.getBranch()) && path.equals(f.getFlowPath()))
                            .findFirst().map(this::copyFlow).orElse(null);
                }
            });
            when(mapper.findByGroupAndFlowId(anyLong(), anyString())).thenAnswer(inv -> {
                Long gid = inv.getArgument(0);
                String fid = inv.getArgument(1);
                synchronized (InMemoryIndexFixture.this) {
                    return flows.stream()
                            .filter(f -> gid.equals(f.getGroupId()) && fid.equals(f.getFlowId()))
                            .map(this::copyFlow).toList();
                }
            });
            when(mapper.findByGroupAndBranchAndFlowId(anyLong(), anyString(), anyString())).thenAnswer(inv -> {
                Long gid = inv.getArgument(0);
                String branch = inv.getArgument(1);
                String fid = inv.getArgument(2);
                synchronized (InMemoryIndexFixture.this) {
                    return flows.stream()
                            .filter(f -> gid.equals(f.getGroupId()) && branch.equals(f.getBranch()) && fid.equals(f.getFlowId()))
                            .map(this::copyFlow).toList();
                }
            });
            when(mapper.findByGroupIds(anyList())).thenAnswer(inv -> {
                List<Long> gids = inv.getArgument(0);
                synchronized (InMemoryIndexFixture.this) {
                    return flows.stream().filter(f -> gids.contains(f.getGroupId())).map(this::copyFlow).toList();
                }
            });
            when(mapper.findByGroupAndFlowIds(anyLong(), anyList())).thenAnswer(inv -> {
                Long gid = inv.getArgument(0);
                List<String> fids = inv.getArgument(1);
                synchronized (InMemoryIndexFixture.this) {
                    return flows.stream()
                            .filter(f -> gid.equals(f.getGroupId()) && fids.contains(f.getFlowId()))
                            .map(this::copyFlow).toList();
                }
            });
            when(mapper.findByGroupAndBranchAndFlowIds(anyLong(), anyString(), anyList())).thenAnswer(inv -> {
                Long gid = inv.getArgument(0);
                String branch = inv.getArgument(1);
                List<String> fids = inv.getArgument(2);
                synchronized (InMemoryIndexFixture.this) {
                    return flows.stream()
                            .filter(f -> gid.equals(f.getGroupId()) && branch.equals(f.getBranch()) && fids.contains(f.getFlowId()))
                            .map(this::copyFlow).toList();
                }
            });
            when(mapper.findByIds(anyList())).thenAnswer(inv -> {
                List<Long> ids = inv.getArgument(0);
                synchronized (InMemoryIndexFixture.this) {
                    return flows.stream().filter(f -> ids.contains(f.getId())).map(this::copyFlow).toList();
                }
            });
            when(mapper.findByGroupAndPathPrefix(anyLong(), anyString())).thenAnswer(inv -> {
                Long gid = inv.getArgument(0);
                String prefix = inv.getArgument(1);
                synchronized (InMemoryIndexFixture.this) {
                    return flows.stream()
                            .filter(f -> gid.equals(f.getGroupId())
                                    && f.getFlowPath() != null && f.getFlowPath().startsWith(prefix))
                            .map(this::copyFlow).toList();
                }
            });
            when(mapper.findByGroupAndBranchAndPathPrefix(anyLong(), anyString(), anyString())).thenAnswer(inv -> {
                Long gid = inv.getArgument(0);
                String branch = inv.getArgument(1);
                String prefix = inv.getArgument(2);
                synchronized (InMemoryIndexFixture.this) {
                    return flows.stream()
                            .filter(f -> gid.equals(f.getGroupId()) && branch.equals(f.getBranch())
                                    && f.getFlowPath() != null && f.getFlowPath().startsWith(prefix))
                            .map(this::copyFlow).toList();
                }
            });
            when(mapper.countInvalidFlows()).thenAnswer(inv -> {
                synchronized (InMemoryIndexFixture.this) {
                    return flows.stream()
                            .filter(f -> !OfflineFlowIndexService.PARSE_STATUS_OK.equals(f.getParseStatus()))
                            .count();
                }
            });
            when(mapper.countDuplicateFlowIds()).thenAnswer(inv -> {
                synchronized (InMemoryIndexFixture.this) {
                    Map<String, Long> counts = flows.stream()
                            .filter(f -> OfflineFlowIndexService.PARSE_STATUS_OK.equals(f.getParseStatus())
                                    && f.getFlowId() != null)
                            .collect(Collectors.groupingBy(f -> f.getGroupId() + ":" + f.getBranch() + ":" + f.getFlowId(), Collectors.counting()));
                    return counts.values().stream().filter(c -> c > 1).count();
                }
            });
            when(mapper.insert(any(WbOfflineFlowIndex.class))).thenAnswer(inv -> {
                maybeFailWrite();
                WbOfflineFlowIndex entity = inv.getArgument(0);
                synchronized (InMemoryIndexFixture.this) {
                    WbOfflineFlowIndex copy = copyFlow(entity);
                    copy.setId(flowSeq.getAndIncrement());
                    flows.add(copy);
                    entity.setId(copy.getId());
                }
                return 1;
            });
            when(mapper.updateById(any(WbOfflineFlowIndex.class))).thenAnswer(inv -> {
                maybeFailWrite();
                WbOfflineFlowIndex entity = inv.getArgument(0);
                synchronized (InMemoryIndexFixture.this) {
                    for (int i = 0; i < flows.size(); i++) {
                        if (Objects.equals(flows.get(i).getId(), entity.getId())) {
                            flows.set(i, copyFlow(entity));
                            return 1;
                        }
                    }
                }
                return 0;
            });
            when(mapper.deleteById(any(Serializable.class))).thenAnswer(inv -> {
                maybeFailWrite();
                Long id = ((Number) inv.getArgument(0)).longValue();
                synchronized (InMemoryIndexFixture.this) {
                    boolean removed = flows.removeIf(f -> id.equals(f.getId()));
                    dependencies.removeIf(d -> id.equals(d.getFlowIndexId()));
                    return removed ? 1 : 0;
                }
            });
            when(mapper.deleteByGroupAndPath(anyLong(), anyString())).thenAnswer(inv -> {
                maybeFailWrite();
                Long gid = inv.getArgument(0);
                String path = inv.getArgument(1);
                synchronized (InMemoryIndexFixture.this) {
                    Set<Long> removedIds = flows.stream()
                            .filter(f -> gid.equals(f.getGroupId()) && path.equals(f.getFlowPath()))
                            .map(WbOfflineFlowIndex::getId)
                            .collect(Collectors.toSet());
                    flows.removeIf(f -> removedIds.contains(f.getId()));
                    dependencies.removeIf(d -> removedIds.contains(d.getFlowIndexId()));
                    return removedIds.size();
                }
            });
            when(mapper.deleteByGroupAndBranchAndPath(anyLong(), anyString(), anyString())).thenAnswer(inv -> {
                maybeFailWrite();
                Long gid = inv.getArgument(0);
                String branch = inv.getArgument(1);
                String path = inv.getArgument(2);
                synchronized (InMemoryIndexFixture.this) {
                    Set<Long> removedIds = flows.stream()
                            .filter(f -> gid.equals(f.getGroupId()) && branch.equals(f.getBranch()) && path.equals(f.getFlowPath()))
                            .map(WbOfflineFlowIndex::getId)
                            .collect(Collectors.toSet());
                    flows.removeIf(f -> removedIds.contains(f.getId()));
                    dependencies.removeIf(d -> removedIds.contains(d.getFlowIndexId()));
                    return removedIds.size();
                }
            });
            when(mapper.deleteByGroupAndPathPrefix(anyLong(), anyString())).thenAnswer(inv -> {
                maybeFailWrite();
                Long gid = inv.getArgument(0);
                String prefix = inv.getArgument(1);
                synchronized (InMemoryIndexFixture.this) {
                    Set<Long> removedIds = flows.stream()
                            .filter(f -> gid.equals(f.getGroupId())
                                    && f.getFlowPath() != null && f.getFlowPath().startsWith(prefix))
                            .map(WbOfflineFlowIndex::getId)
                            .collect(Collectors.toSet());
                    flows.removeIf(f -> removedIds.contains(f.getId()));
                    dependencies.removeIf(d -> removedIds.contains(d.getFlowIndexId()));
                    return removedIds.size();
                }
            });
            when(mapper.deleteByGroupAndBranchAndPathPrefix(anyLong(), anyString(), anyString())).thenAnswer(inv -> {
                maybeFailWrite();
                Long gid = inv.getArgument(0);
                String branch = inv.getArgument(1);
                String prefix = inv.getArgument(2);
                synchronized (InMemoryIndexFixture.this) {
                    Set<Long> removedIds = flows.stream()
                            .filter(f -> gid.equals(f.getGroupId()) && branch.equals(f.getBranch())
                                    && f.getFlowPath() != null && f.getFlowPath().startsWith(prefix))
                            .map(WbOfflineFlowIndex::getId)
                            .collect(Collectors.toSet());
                    flows.removeIf(f -> removedIds.contains(f.getId()));
                    dependencies.removeIf(d -> removedIds.contains(d.getFlowIndexId()));
                    return removedIds.size();
                }
            });
            when(mapper.deleteByGroupAndBranch(anyLong(), anyString())).thenAnswer(inv -> {
                maybeFailWrite();
                Long gid = inv.getArgument(0);
                String branch = inv.getArgument(1);
                synchronized (InMemoryIndexFixture.this) {
                    Set<Long> removedIds = flows.stream()
                            .filter(f -> gid.equals(f.getGroupId()) && branch.equals(f.getBranch()))
                            .map(WbOfflineFlowIndex::getId)
                            .collect(Collectors.toSet());
                    flows.removeIf(f -> removedIds.contains(f.getId()));
                    dependencies.removeIf(d -> removedIds.contains(d.getFlowIndexId()));
                    return removedIds.size();
                }
            });
            return mapper;
        }

        private WbOfflineFlowDependency copyDep(WbOfflineFlowDependency src) {
            WbOfflineFlowDependency copy = new WbOfflineFlowDependency();
            copy.setId(src.getId());
            copy.setFlowIndexId(src.getFlowIndexId());
            copy.setDownstreamGroupId(src.getDownstreamGroupId());
            copy.setDownstreamFlowId(src.getDownstreamFlowId());
            copy.setUpstreamGroupId(src.getUpstreamGroupId());
            copy.setUpstreamFlowId(src.getUpstreamFlowId());
            return copy;
        }

        private WbOfflineFlowDependencyMapper createDepMapper() {
            WbOfflineFlowDependencyMapper mapper = mock(WbOfflineFlowDependencyMapper.class);
            when(mapper.findByUpstream(anyLong(), anyString())).thenAnswer(inv -> {
                Long gid = inv.getArgument(0);
                String fid = inv.getArgument(1);
                synchronized (InMemoryIndexFixture.this) {
                    return dependencies.stream()
                            .filter(d -> gid.equals(d.getUpstreamGroupId()) && fid.equals(d.getUpstreamFlowId()))
                            .map(this::copyDep).toList();
                }
            });
            when(mapper.findByUpstreamGroupAndFlowIds(anyLong(), anyList())).thenAnswer(inv -> {
                Long gid = inv.getArgument(0);
                List<String> fids = inv.getArgument(1);
                synchronized (InMemoryIndexFixture.this) {
                    return dependencies.stream()
                            .filter(d -> gid.equals(d.getUpstreamGroupId()) && fids.contains(d.getUpstreamFlowId()))
                            .map(this::copyDep).toList();
                }
            });
            when(mapper.findByDownstreamGroupAndFlowIds(anyLong(), anyList())).thenAnswer(inv -> {
                Long gid = inv.getArgument(0);
                List<String> fids = inv.getArgument(1);
                synchronized (InMemoryIndexFixture.this) {
                    return dependencies.stream()
                            .filter(d -> gid.equals(d.getDownstreamGroupId()) && fids.contains(d.getDownstreamFlowId()))
                            .map(this::copyDep).toList();
                }
            });
            when(mapper.deleteByFlowIndexId(anyLong())).thenAnswer(inv -> {
                maybeFailWrite();
                Long fid = inv.getArgument(0);
                synchronized (InMemoryIndexFixture.this) {
                    int before = dependencies.size();
                    dependencies.removeIf(d -> fid.equals(d.getFlowIndexId()));
                    return before - dependencies.size();
                }
            });
            when(mapper.insert(any(WbOfflineFlowDependency.class))).thenAnswer(inv -> {
                maybeFailWrite();
                WbOfflineFlowDependency edge = inv.getArgument(0);
                synchronized (InMemoryIndexFixture.this) {
                    WbOfflineFlowDependency copy = copyDep(edge);
                    copy.setId(depSeq.getAndIncrement());
                    dependencies.add(copy);
                    edge.setId(copy.getId());
                }
                return 1;
            });
            return mapper;
        }

        private WbOfflineRepoIndexState copyState(WbOfflineRepoIndexState src) {
            WbOfflineRepoIndexState copy = new WbOfflineRepoIndexState();
            copy.setGroupId(src.getGroupId());
            copy.setBranch(src.getBranch());
            copy.setSyncedBranch(src.getSyncedBranch());
            copy.setSyncedHeadSha(src.getSyncedHeadSha());
            copy.setFlowCount(src.getFlowCount());
            copy.setIndexedAt(src.getIndexedAt());
            return copy;
        }

        private WbOfflineRepoIndexStateMapper createStateMapper() {
            WbOfflineRepoIndexStateMapper mapper = mock(WbOfflineRepoIndexStateMapper.class);
            when(mapper.findAllGroupIds()).thenAnswer(inv -> {
                synchronized (InMemoryIndexFixture.this) {
                    return states.stream().map(WbOfflineRepoIndexState::getGroupId).distinct().toList();
                }
            });
            when(mapper.findByGroupAndBranch(anyLong(), anyString())).thenAnswer(inv -> {
                Long gid = inv.getArgument(0);
                String branch = inv.getArgument(1);
                synchronized (InMemoryIndexFixture.this) {
                    return states.stream()
                            .filter(s -> gid.equals(s.getGroupId()) && branch.equals(s.getBranch()))
                            .findFirst().map(this::copyState).orElse(null);
                }
            });
            when(mapper.upsertState(any(WbOfflineRepoIndexState.class))).thenAnswer(inv -> {
                WbOfflineRepoIndexState state = inv.getArgument(0);
                synchronized (InMemoryIndexFixture.this) {
                    states.removeIf(s -> Objects.equals(s.getGroupId(), state.getGroupId())
                            && Objects.equals(s.getBranch(), state.getBranch()));
                    states.add(copyState(state));
                }
                return 1;
            });
            when(mapper.adjustFlowCount(anyLong(), anyString(), anyInt(), any())).thenAnswer(inv -> {
                Long gid = inv.getArgument(0);
                String branch = inv.getArgument(1);
                int delta = inv.getArgument(2);
                synchronized (InMemoryIndexFixture.this) {
                    for (WbOfflineRepoIndexState state : states) {
                        if (gid.equals(state.getGroupId()) && branch.equals(state.getBranch())) {
                            int current = state.getFlowCount() == null ? 0 : state.getFlowCount();
                            state.setFlowCount(Math.max(0, current + delta));
                            return 1;
                        }
                    }
                }
                return 0;
            });
            when(mapper.deleteByGroupAndBranch(anyLong(), anyString())).thenAnswer(inv -> {
                Long gid = inv.getArgument(0);
                String branch = inv.getArgument(1);
                synchronized (InMemoryIndexFixture.this) {
                    return states.removeIf(s -> gid.equals(s.getGroupId()) && branch.equals(s.getBranch())) ? 1 : 0;
                }
            });
            when(mapper.selectById(any(Serializable.class))).thenAnswer(inv -> {
                Long gid = ((Number) inv.getArgument(0)).longValue();
                synchronized (InMemoryIndexFixture.this) {
                    return states.stream().filter(s -> gid.equals(s.getGroupId())).findFirst().map(this::copyState).orElse(null);
                }
            });
            when(mapper.insert(any(WbOfflineRepoIndexState.class))).thenAnswer(inv -> {
                WbOfflineRepoIndexState state = inv.getArgument(0);
                synchronized (InMemoryIndexFixture.this) {
                    states.add(copyState(state));
                }
                return 1;
            });
            when(mapper.updateById(any(WbOfflineRepoIndexState.class))).thenAnswer(inv -> {
                WbOfflineRepoIndexState state = inv.getArgument(0);
                synchronized (InMemoryIndexFixture.this) {
                    for (int i = 0; i < states.size(); i++) {
                        if (Objects.equals(states.get(i).getGroupId(), state.getGroupId())) {
                            states.set(i, copyState(state));
                            return 1;
                        }
                    }
                }
                return 0;
            });
            return mapper;
        }
    }
}
