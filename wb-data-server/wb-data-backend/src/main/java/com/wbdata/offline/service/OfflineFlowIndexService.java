package com.wbdata.offline.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.wbdata.group.entity.WbProjectGroup;
import com.wbdata.group.mapper.WbProjectGroupMapper;
import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.entity.WbOfflineFlowDependency;
import com.wbdata.offline.entity.WbOfflineFlowIndex;
import com.wbdata.offline.entity.WbOfflineRepoIndexState;
import com.wbdata.offline.enums.OfflineCrossGroupDependency;
import com.wbdata.offline.enums.OfflineFailurePolicy;
import com.wbdata.offline.enums.OfflineSchedulePeriod;
import com.wbdata.offline.mapper.WbOfflineFlowDependencyMapper;
import com.wbdata.offline.mapper.WbOfflineFlowIndexMapper;
import com.wbdata.offline.mapper.WbOfflineRepoIndexStateMapper;
import com.wbdata.offline.repo.service.RepoLockManager;
import com.wbdata.offline.schedule.dto.OfflineFlowDependencyRef;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.lang.Nullable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * 离线任务与依赖边投影索引服务：
 * - 磁盘 _flows/star/flow.yaml 与 Git 工作区始终为唯一事实来源；
 * - MySQL 索引表用于加速依赖校验、下游反查、环检测、目录树构建与文件夹删除校验；
 * - 单次写盘后按组锁内增量写通；Git 切分支/合并/rebase 后按文件 mtime+size 增量对账。
 */
@Slf4j
@Service
public class OfflineFlowIndexService {

    public static final String PARSE_STATUS_OK = "OK";
    public static final String PARSE_STATUS_INVALID = "INVALID";

    private static final long GIT_READ_TIMEOUT_SECONDS = 5L;

    private final OfflineProperties offlineProperties;
    private final RepoLockManager repoLockManager;
    @Nullable
    private final WbOfflineFlowIndexMapper indexMapper;
    @Nullable
    private final WbOfflineFlowDependencyMapper dependencyMapper;
    @Nullable
    private final WbOfflineRepoIndexStateMapper stateMapper;
    @Nullable
    private final TransactionTemplate transactionTemplate;
    @Nullable
    private final WbProjectGroupMapper projectGroupMapper;

    private final OfflineFlowYamlSupport yamlSupport = new OfflineFlowYamlSupport();
    private final Set<Long> indexedGroups = ConcurrentHashMap.newKeySet();
    private final Set<Long> dirtyGroups = ConcurrentHashMap.newKeySet();
    private final Object startupMonitor = new Object();
    private volatile boolean startupReconciled = false;

    public OfflineFlowIndexService(OfflineProperties offlineProperties,
                                   RepoLockManager repoLockManager,
                                   @Nullable WbOfflineFlowIndexMapper indexMapper,
                                   @Nullable WbOfflineFlowDependencyMapper dependencyMapper,
                                   @Nullable WbOfflineRepoIndexStateMapper stateMapper) {
        this(offlineProperties, repoLockManager, indexMapper, dependencyMapper, stateMapper, null, null);
    }

    @Autowired
    public OfflineFlowIndexService(OfflineProperties offlineProperties,
                                   RepoLockManager repoLockManager,
                                   @Nullable WbOfflineFlowIndexMapper indexMapper,
                                   @Nullable WbOfflineFlowDependencyMapper dependencyMapper,
                                   @Nullable WbOfflineRepoIndexStateMapper stateMapper,
                                   @Nullable TransactionTemplate transactionTemplate,
                                   @Nullable WbProjectGroupMapper projectGroupMapper) {
        this.offlineProperties = offlineProperties;
        this.repoLockManager = repoLockManager;
        this.indexMapper = indexMapper;
        this.dependencyMapper = dependencyMapper;
        this.stateMapper = stateMapper;
        this.transactionTemplate = transactionTemplate;
        this.projectGroupMapper = projectGroupMapper;
    }

    public boolean isEnabled() {
        return indexMapper != null && dependencyMapper != null && stateMapper != null;
    }

    public record IndexedFlowSnapshot(
            Long flowIndexId,
            Long groupId,
            String path,
            String flowId,
            boolean parseOk,
            boolean hasSchedule,
            OfflineSchedulePeriod period,
            OfflineCrossGroupDependency crossGroupDependency,
            OfflineFailurePolicy failurePolicy,
            String cron,
            String timezone,
            boolean enabled
    ) {
    }

    public void reconcileAllExistingGroupsAtStartup() {
        if (!isEnabled()) {
            startupReconciled = true;
            return;
        }
        synchronized (startupMonitor) {
            if (startupReconciled) {
                return;
            }
            List<Long> groupIds = collectKnownGroupIds();
            for (Long groupId : groupIds) {
                try {
                    reconcileGroup(groupId);
                } catch (RuntimeException ex) {
                    log.warn("启动对账项目组离线任务索引失败，已标记待自愈: groupId={}, reason={}", groupId, ex.getMessage(), ex);
                    markDirty(groupId);
                }
            }
            startupReconciled = true;
        }
    }

    public void reconcileGroup(Long groupId) {
        if (!isEnabled() || groupId == null) {
            return;
        }
        repoLockManager.withLock(groupId, () -> {
            reconcileGroupUnlocked(groupId);
            return null;
        });
    }

    public void onGroupRepoInitialized(Long groupId, String branch) {
        if (!isEnabled() || groupId == null) {
            return;
        }
        try {
            if (!groupExistsInDb(groupId)) {
                return;
            }
            runInTransaction(() -> upsertRepoState(groupId, branch, null, 0));
            dirtyGroups.remove(groupId);
            indexedGroups.add(groupId);
        } catch (RuntimeException ex) {
            log.error("初始化离线仓库索引状态失败: groupId={}", groupId, ex);
            markDirty(groupId);
        }
    }

    public void onFlowSaved(Long groupId, String flowPath, String yamlContent, @Nullable Path flowFile) {
        if (!isEnabled() || groupId == null || flowPath == null || flowPath.isBlank()) {
            return;
        }
        String normalizedPath = normalizeFlowPath(flowPath);
        if (normalizedPath.isEmpty()) {
            return;
        }
        try {
            FileStat stat = readFileStat(flowFile);
            runInTransaction(() -> upsertFlowUnlocked(groupId, normalizedPath, yamlContent, stat));
        } catch (RuntimeException ex) {
            log.error("写通更新离线任务索引失败，已标记待自愈: groupId={}, path={}", groupId, normalizedPath, ex);
            markDirty(groupId);
        }
    }

    public void onFlowDeleted(Long groupId, String flowPath) {
        if (!isEnabled() || groupId == null || flowPath == null || flowPath.isBlank()) {
            return;
        }
        String normalizedPath = normalizeFlowPath(flowPath);
        if (normalizedPath.isEmpty()) {
            return;
        }
        try {
            runInTransaction(() -> {
                int removed = indexMapper.deleteByGroupAndPath(groupId, normalizedPath);
                if (removed > 0) {
                    adjustStateFlowCount(groupId, -removed);
                }
            });
        } catch (RuntimeException ex) {
            log.error("删除离线任务索引失败，已标记待自愈: groupId={}, path={}", groupId, normalizedPath, ex);
            markDirty(groupId);
        }
    }

    public void onFlowMoved(Long groupId, String oldPath, String newPath, @Nullable Path newFlowFile) {
        if (!isEnabled() || groupId == null || oldPath == null || oldPath.isBlank()
                || newPath == null || newPath.isBlank()) {
            return;
        }
        String oldNormalized = normalizeFlowPath(oldPath);
        String newNormalized = normalizeFlowPath(newPath);
        if (oldNormalized.equals(newNormalized)) {
            return;
        }
        try {
            FileStat stat = readFileStat(newFlowFile);
            String diskContent = readStringIfRegularFile(newFlowFile);
            runInTransaction(() -> {
                WbOfflineFlowIndex targetExisting = indexMapper.findByGroupAndPath(groupId, newNormalized);
                if (targetExisting != null && targetExisting.getId() != null) {
                    indexMapper.deleteById(targetExisting.getId());
                }
                WbOfflineFlowIndex existing = indexMapper.findByGroupAndPath(groupId, oldNormalized);
                if (existing != null) {
                    existing.setFlowPath(newNormalized);
                    existing.setFileMtimeMs(stat.mtimeMs());
                    existing.setFileSize(stat.size());
                    existing.setUpdatedAt(LocalDateTime.now());
                    indexMapper.updateById(existing);
                    return;
                }
                if (diskContent != null) {
                    upsertFlowUnlocked(groupId, newNormalized, diskContent, stat);
                }
            });
        } catch (RuntimeException ex) {
            log.error("移动离线任务索引失败，已标记待自愈: groupId={}, oldPath={}, newPath={}",
                    groupId, oldNormalized, newNormalized, ex);
            markDirty(groupId);
        }
    }

    public void onFolderDeleted(Long groupId, String folderPath) {
        if (!isEnabled() || groupId == null || folderPath == null || folderPath.isBlank()) {
            return;
        }
        String prefix = normalizeFolderPrefix(folderPath);
        if (prefix.isEmpty()) {
            return;
        }
        try {
            runInTransaction(() -> {
                int removed = indexMapper.deleteByGroupAndPathPrefix(groupId, prefix);
                if (removed > 0) {
                    adjustStateFlowCount(groupId, -removed);
                }
            });
        } catch (RuntimeException ex) {
            log.error("删除文件夹离线任务索引失败，已标记待自愈: groupId={}, folderPath={}", groupId, folderPath, ex);
            markDirty(groupId);
        }
    }

    public void onFolderMoved(Long groupId, String oldFolderPath, String newFolderPath, Path repoPath) {
        if (!isEnabled() || groupId == null || oldFolderPath == null || oldFolderPath.isBlank()
                || newFolderPath == null || newFolderPath.isBlank()) {
            return;
        }
        String oldPrefix = normalizeFolderPrefix(oldFolderPath);
        String newPrefix = normalizeFolderPrefix(newFolderPath);
        if (oldPrefix.isEmpty() || newPrefix.isEmpty() || oldPrefix.equals(newPrefix)) {
            return;
        }
        try {
            List<WbOfflineFlowIndex> movingRows = indexMapper.findByGroupAndPathPrefix(groupId, oldPrefix);
            if (movingRows.isEmpty()) {
                return;
            }
            Map<String, FileStat> statsByNewPath = new HashMap<>();
            for (WbOfflineFlowIndex row : movingRows) {
                String currentPath = row.getFlowPath();
                if (currentPath == null || !currentPath.startsWith(oldPrefix)) {
                    continue;
                }
                String nextPath = newPrefix + currentPath.substring(oldPrefix.length());
                Path nextFile = repoPath == null ? null : repoPath.resolve(nextPath);
                statsByNewPath.put(nextPath, readFileStat(nextFile));
            }
            runInTransaction(() -> {
                indexMapper.deleteByGroupAndPathPrefix(groupId, newPrefix);
                for (WbOfflineFlowIndex row : movingRows) {
                    String currentPath = row.getFlowPath();
                    if (currentPath == null || !currentPath.startsWith(oldPrefix)) {
                        continue;
                    }
                    String nextPath = newPrefix + currentPath.substring(oldPrefix.length());
                    FileStat stat = statsByNewPath.getOrDefault(nextPath, FileStat.EMPTY);
                    row.setFlowPath(nextPath);
                    row.setFileMtimeMs(stat.mtimeMs());
                    row.setFileSize(stat.size());
                    row.setUpdatedAt(LocalDateTime.now());
                    indexMapper.updateById(row);
                }
            });
        } catch (RuntimeException ex) {
            log.error("移动文件夹离线任务索引失败，已标记待自愈: groupId={}, old={}, new={}",
                    groupId, oldPrefix, newPrefix, ex);
            markDirty(groupId);
        }
    }

    public void ensureGroupIndexed(Long groupId) {
        if (!isEnabled() || groupId == null) {
            return;
        }
        if (indexedGroups.contains(groupId) && !dirtyGroups.contains(groupId)) {
            return;
        }
        repoLockManager.withLock(groupId, () -> {
            if (indexedGroups.contains(groupId) && !dirtyGroups.contains(groupId)) {
                return null;
            }
            if (startupReconciled && !dirtyGroups.contains(groupId) && stateMapper.selectById(groupId) != null) {
                indexedGroups.add(groupId);
                return null;
            }
            reconcileGroupUnlocked(groupId);
            return null;
        });
    }

    public void ensureGlobalIndexReady() {
        if (!isEnabled()) {
            return;
        }
        if (!startupReconciled) {
            reconcileAllExistingGroupsAtStartup();
        }
        if (!dirtyGroups.isEmpty()) {
            for (Long dirtyGroupId : List.copyOf(dirtyGroups)) {
                reconcileGroup(dirtyGroupId);
            }
        }
    }

    public void assertGraphHealthy() {
        ensureGlobalIndexReady();
        if (indexMapper.countInvalidFlows() > 0) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "无法读取完整任务依赖图，请联系管理员检查");
        }
        if (indexMapper.countDuplicateFlowIds() > 0) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "任务依赖图存在重复标识，请联系管理员修复");
        }
    }

    public Map<String, WbOfflineFlowIndex> listGroupFlowMap(Long groupId) {
        if (!isEnabled() || groupId == null) {
            return Map.of();
        }
        ensureGroupIndexed(groupId);
        List<WbOfflineFlowIndex> rows = indexMapper.findByGroup(groupId);
        Map<String, WbOfflineFlowIndex> result = new LinkedHashMap<>(rows.size());
        for (WbOfflineFlowIndex row : rows) {
            if (row.getFlowPath() != null) {
                result.put(normalizeFlowPath(row.getFlowPath()), row);
            }
        }
        return result;
    }

    public List<WbOfflineFlowIndex> listFlowsByGroupAndOwner(Long groupId, Long ownerUserId) {
        if (!isEnabled() || groupId == null || ownerUserId == null) {
            return List.of();
        }
        ensureGroupIndexed(groupId);
        List<WbOfflineFlowIndex> rows = indexMapper.findByGroupAndOwnerUserId(groupId, ownerUserId);
        return rows == null ? List.of() : rows;
    }

    public long countFlowsByGroupAndOwner(Long groupId, Long ownerUserId) {
        if (!isEnabled() || groupId == null || ownerUserId == null) {
            return 0L;
        }
        ensureGroupIndexed(groupId);
        return indexMapper.countByGroupAndOwnerUserId(groupId, ownerUserId);
    }

    public Map<Long, Long> countFlowsByOwnerAcrossGroups(Long ownerUserId) {
        if (!isEnabled() || ownerUserId == null) {
            return Map.of();
        }
        ensureGlobalIndexReady();
        List<Map<String, Object>> rows = indexMapper.countByOwnerUserIdGroupByGroup(ownerUserId);
        if (rows == null || rows.isEmpty()) {
            return Map.of();
        }
        Map<Long, Long> counts = new LinkedHashMap<>();
        for (Map<String, Object> row : rows) {
            Object rawGroupId = row.get("groupId");
            Object rawCnt = row.get("cnt");
            if (rawGroupId instanceof Number gid && rawCnt instanceof Number cnt) {
                long value = cnt.longValue();
                if (value > 0) {
                    counts.put(gid.longValue(), value);
                }
            }
        }
        return counts;
    }

    public List<IndexedFlowSnapshot> findFlowsByGroupIds(Collection<Long> groupIds) {
        if (!isEnabled() || groupIds == null || groupIds.isEmpty()) {
            return List.of();
        }
        List<Long> distinctGroupIds = groupIds.stream()
                .filter(Objects::nonNull)
                .distinct()
                .toList();
        if (distinctGroupIds.isEmpty()) {
            return List.of();
        }
        for (Long groupId : distinctGroupIds) {
            ensureGroupIndexed(groupId);
        }
        return indexMapper.findByGroupIds(distinctGroupIds).stream()
                .filter(this::isParseOk)
                .map(this::toSnapshot)
                .toList();
    }

    public Map<OfflineFlowDependencyRef, IndexedFlowSnapshot> findFlowsByRefs(Collection<OfflineFlowDependencyRef> refs) {
        if (!isEnabled() || refs == null || refs.isEmpty()) {
            return Map.of();
        }
        Map<Long, Set<String>> flowIdsByGroup = new LinkedHashMap<>();
        for (OfflineFlowDependencyRef ref : refs) {
            if (ref == null || ref.groupId() == null || ref.flowId() == null || ref.flowId().isBlank()) {
                continue;
            }
            flowIdsByGroup.computeIfAbsent(ref.groupId(), ignored -> new LinkedHashSet<>()).add(ref.flowId());
        }
        if (flowIdsByGroup.isEmpty()) {
            return Map.of();
        }
        Map<OfflineFlowDependencyRef, IndexedFlowSnapshot> result = new LinkedHashMap<>();
        for (Map.Entry<Long, Set<String>> entry : flowIdsByGroup.entrySet()) {
            ensureGroupIndexed(entry.getKey());
            List<WbOfflineFlowIndex> rows = indexMapper.findByGroupAndFlowIds(
                    entry.getKey(), List.copyOf(entry.getValue()));
            for (WbOfflineFlowIndex row : rows) {
                if (isParseOk(row) && row.getFlowId() != null) {
                    result.putIfAbsent(new OfflineFlowDependencyRef(row.getGroupId(), row.getFlowId()), toSnapshot(row));
                }
            }
        }
        return result;
    }

    @Nullable
    public IndexedFlowSnapshot findByGroupAndFlowId(Long groupId, String flowId) {
        if (!isEnabled() || groupId == null || flowId == null || flowId.isBlank()) {
            return null;
        }
        ensureGroupIndexed(groupId);
        List<WbOfflineFlowIndex> rows = indexMapper.findByGroupAndFlowId(groupId, flowId);
        return rows.stream()
                .filter(this::isParseOk)
                .findFirst()
                .map(this::toSnapshot)
                .orElse(null);
    }

    public List<IndexedFlowSnapshot> findDirectDependents(OfflineFlowDependencyRef upstream) {
        if (!isEnabled() || upstream == null || upstream.groupId() == null
                || upstream.flowId() == null || upstream.flowId().isBlank()) {
            return List.of();
        }
        ensureGlobalIndexReady();
        List<WbOfflineFlowDependency> edges = dependencyMapper.findByUpstream(upstream.groupId(), upstream.flowId());
        if (edges.isEmpty()) {
            return List.of();
        }
        List<Long> indexIds = edges.stream()
                .map(WbOfflineFlowDependency::getFlowIndexId)
                .filter(Objects::nonNull)
                .distinct()
                .toList();
        if (indexIds.isEmpty()) {
            return List.of();
        }
        return indexMapper.findByIds(indexIds).stream()
                .filter(this::isParseOk)
                .map(this::toSnapshot)
                .toList();
    }

    public List<IndexedFlowSnapshot> findExternalDependentsOfFolder(Long groupId, String folderPath) {
        if (!isEnabled() || groupId == null || folderPath == null || folderPath.isBlank()) {
            return List.of();
        }
        String prefix = normalizeFolderPrefix(folderPath);
        if (prefix.isEmpty()) {
            return List.of();
        }
        ensureGlobalIndexReady();
        List<WbOfflineFlowIndex> folderFlows = indexMapper.findByGroupAndPathPrefix(groupId, prefix);
        if (folderFlows.isEmpty()) {
            return List.of();
        }
        Set<Long> deletedIndexIds = new HashSet<>();
        List<String> targetFlowIds = new ArrayList<>();
        for (WbOfflineFlowIndex row : folderFlows) {
            if (row.getId() != null) {
                deletedIndexIds.add(row.getId());
            }
            if (row.getFlowId() != null && !row.getFlowId().isBlank()) {
                targetFlowIds.add(row.getFlowId());
            }
        }
        List<String> distinctFlowIds = targetFlowIds.stream().distinct().toList();
        if (distinctFlowIds.isEmpty()) {
            return List.of();
        }
        List<WbOfflineFlowDependency> incomingEdges =
                dependencyMapper.findByUpstreamGroupAndFlowIds(groupId, distinctFlowIds);
        List<Long> externalIndexIds = incomingEdges.stream()
                .map(WbOfflineFlowDependency::getFlowIndexId)
                .filter(id -> id != null && !deletedIndexIds.contains(id))
                .distinct()
                .toList();
        if (externalIndexIds.isEmpty()) {
            return List.of();
        }
        return indexMapper.findByIds(externalIndexIds).stream()
                .filter(this::isParseOk)
                .map(this::toSnapshot)
                .toList();
    }

    public boolean createsCycle(OfflineFlowDependencyRef self, List<OfflineFlowDependencyRef> newDependencies) {
        if (!isEnabled() || self == null || newDependencies == null || newDependencies.isEmpty()) {
            return false;
        }
        ensureGlobalIndexReady();
        Set<OfflineFlowDependencyRef> visited = new HashSet<>();
        List<OfflineFlowDependencyRef> frontier = new ArrayList<>(newDependencies);
        while (!frontier.isEmpty()) {
            Map<Long, Set<String>> nextByGroup = new LinkedHashMap<>();
            for (OfflineFlowDependencyRef node : frontier) {
                if (node == null || node.groupId() == null || node.flowId() == null || node.flowId().isBlank()) {
                    continue;
                }
                if (node.equals(self)) {
                    return true;
                }
                if (visited.add(node)) {
                    nextByGroup.computeIfAbsent(node.groupId(), ignored -> new LinkedHashSet<>()).add(node.flowId());
                }
            }
            if (nextByGroup.isEmpty()) {
                break;
            }
            List<OfflineFlowDependencyRef> nextFrontier = new ArrayList<>();
            for (Map.Entry<Long, Set<String>> entry : nextByGroup.entrySet()) {
                List<WbOfflineFlowDependency> edges = dependencyMapper.findByDownstreamGroupAndFlowIds(
                        entry.getKey(), List.copyOf(entry.getValue()));
                for (WbOfflineFlowDependency edge : edges) {
                    if (edge.getUpstreamGroupId() != null
                            && edge.getUpstreamFlowId() != null
                            && !edge.getUpstreamFlowId().isBlank()) {
                        nextFrontier.add(new OfflineFlowDependencyRef(
                                edge.getUpstreamGroupId(), edge.getUpstreamFlowId()));
                    }
                }
            }
            frontier = nextFrontier;
        }
        return false;
    }

    private void reconcileGroupUnlocked(Long groupId) {
        if (!groupExistsInDb(groupId)) {
            dirtyGroups.remove(groupId);
            return;
        }
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        Path flowsDir = repoPath.resolve("_flows");
        Map<String, Path> diskFlows = collectDiskFlows(repoPath, flowsDir);
        List<WbOfflineFlowIndex> existingRows = indexMapper.findByGroup(groupId);
        Map<String, WbOfflineFlowIndex> dbByPath = new HashMap<>(existingRows.size());
        for (WbOfflineFlowIndex row : existingRows) {
            if (row.getFlowPath() != null) {
                dbByPath.put(normalizeFlowPath(row.getFlowPath()), row);
            }
        }

        List<WbOfflineFlowIndex> toDelete = new ArrayList<>();
        for (WbOfflineFlowIndex row : existingRows) {
            String normalizedPath = row.getFlowPath() == null ? "" : normalizeFlowPath(row.getFlowPath());
            if (!diskFlows.containsKey(normalizedPath)) {
                toDelete.add(row);
            }
        }

        List<PendingUpsert> toUpsert = new ArrayList<>();
        for (Map.Entry<String, Path> entry : diskFlows.entrySet()) {
            String flowPath = entry.getKey();
            Path flowFile = entry.getValue();
            FileStat stat = readFileStat(flowFile);
            WbOfflineFlowIndex existing = dbByPath.get(flowPath);
            if (existing != null
                    && PARSE_STATUS_OK.equals(existing.getParseStatus())
                    && Objects.equals(existing.getFileMtimeMs(), stat.mtimeMs())
                    && Objects.equals(existing.getFileSize(), stat.size())) {
                continue;
            }
            String content = readStringIfRegularFile(flowFile);
            toUpsert.add(new PendingUpsert(flowPath, content, stat, existing));
        }

        String branch = readGitBranch(repoPath);
        String headSha = readGitHead(repoPath);
        int flowCount = diskFlows.size();

        runInTransaction(() -> {
            for (WbOfflineFlowIndex row : toDelete) {
                if (row.getId() != null) {
                    indexMapper.deleteById(row.getId());
                }
            }
            for (PendingUpsert pending : toUpsert) {
                persistParsedFlow(groupId, pending.flowPath(), pending.content(), pending.stat(), pending.existing());
            }
            upsertRepoState(groupId, branch, headSha, flowCount);
        });

        dirtyGroups.remove(groupId);
        indexedGroups.add(groupId);
    }

    private Map<String, Path> collectDiskFlows(Path repoPath, Path flowsDir) {
        if (!Files.isDirectory(flowsDir)) {
            return Map.of();
        }
        Map<String, Path> flows = new LinkedHashMap<>();
        try (var stream = Files.walk(flowsDir)) {
            for (Path candidate : stream.filter(p -> Files.isRegularFile(p)
                    && "flow.yaml".equals(p.getFileName().toString())).toList()) {
                String relative = normalizeFlowPath(repoPath.relativize(candidate).toString());
                flows.put(relative, candidate);
            }
        } catch (IOException | java.io.UncheckedIOException ex) {
            throw new IllegalStateException("扫描项目组离线任务目录失败: groupRepo=" + repoPath, ex);
        }
        return flows;
    }

    private void upsertFlowUnlocked(Long groupId, String normalizedPath, String yamlContent, FileStat stat) {
        WbOfflineFlowIndex existing = indexMapper.findByGroupAndPath(groupId, normalizedPath);
        persistParsedFlow(groupId, normalizedPath, yamlContent, stat, existing);
        if (existing == null) {
            adjustStateFlowCount(groupId, 1);
        }
    }

    private void persistParsedFlow(Long groupId,
                                   String normalizedPath,
                                   @Nullable String yamlContent,
                                   FileStat stat,
                                   @Nullable WbOfflineFlowIndex existing) {
        ParsedFlowProjection parsed = parseForProjection(yamlContent);
        WbOfflineFlowIndex entity = parsed.toEntity(groupId, normalizedPath, stat);
        if (existing != null && existing.getId() != null) {
            entity.setId(existing.getId());
            indexMapper.updateById(entity);
            dependencyMapper.deleteByFlowIndexId(existing.getId());
        } else {
            indexMapper.insert(entity);
        }

        if (PARSE_STATUS_OK.equals(entity.getParseStatus())
                && entity.getFlowId() != null
                && !parsed.dependencies().isEmpty()) {
            Set<String> seenEdges = new HashSet<>();
            for (OfflineFlowDependencyRef ref : parsed.dependencies()) {
                if (ref == null || ref.groupId() == null || ref.flowId() == null || ref.flowId().isBlank()) {
                    continue;
                }
                String dedupKey = ref.groupId() + ":" + ref.flowId();
                if (!seenEdges.add(dedupKey)) {
                    continue;
                }
                WbOfflineFlowDependency edge = new WbOfflineFlowDependency();
                edge.setFlowIndexId(entity.getId());
                edge.setDownstreamGroupId(groupId);
                edge.setDownstreamFlowId(entity.getFlowId());
                edge.setUpstreamGroupId(ref.groupId());
                edge.setUpstreamFlowId(ref.flowId());
                dependencyMapper.insert(edge);
            }
        }
    }

    private ParsedFlowProjection parseForProjection(@Nullable String yamlContent) {
        if (yamlContent == null) {
            return ParsedFlowProjection.invalid();
        }
        try {
            OfflineFlowYamlSupport.FlowIndexMetadata meta = yamlSupport.parseIndexMetadata(yamlContent);
            return new ParsedFlowProjection(
                    PARSE_STATUS_OK,
                    meta.flowId(),
                    meta.ownerUserId(),
                    meta.schedule(),
                    meta.crossGroupDependency(),
                    meta.failurePolicy(),
                    meta.dependencies()
            );
        } catch (RuntimeException ex) {
            return ParsedFlowProjection.invalid();
        }
    }

    private void adjustStateFlowCount(Long groupId, int delta) {
        WbOfflineRepoIndexState state = stateMapper.selectById(groupId);
        if (state == null) {
            return;
        }
        int current = state.getFlowCount() == null ? 0 : state.getFlowCount();
        state.setFlowCount(Math.max(0, current + delta));
        state.setIndexedAt(LocalDateTime.now());
        stateMapper.updateById(state);
    }

    private void upsertRepoState(Long groupId, @Nullable String branch, @Nullable String headSha, int flowCount) {
        WbOfflineRepoIndexState existing = stateMapper.selectById(groupId);
        WbOfflineRepoIndexState state = existing == null ? new WbOfflineRepoIndexState() : existing;
        state.setGroupId(groupId);
        state.setSyncedBranch(branch);
        state.setSyncedHeadSha(headSha);
        state.setFlowCount(flowCount);
        state.setIndexedAt(LocalDateTime.now());
        if (existing == null) {
            stateMapper.insert(state);
        } else {
            stateMapper.updateById(state);
        }
    }

    private List<Long> collectKnownGroupIds() {
        if (projectGroupMapper != null) {
            List<WbProjectGroup> groups = projectGroupMapper.selectList(Wrappers.emptyWrapper());
            return groups == null ? List.of() : groups.stream()
                    .map(WbProjectGroup::getId)
                    .filter(Objects::nonNull)
                    .distinct()
                    .toList();
        }
        LinkedHashSet<Long> ids = new LinkedHashSet<>();
        List<Long> stateIds = stateMapper.findAllGroupIds();
        if (stateIds != null) {
            ids.addAll(stateIds);
        }
        Path base = Path.of(offlineProperties.getRepoBaseDir());
        String prefix = offlineProperties.getRepoDirPrefix();
        if (Files.isDirectory(base)) {
            try (var directories = Files.list(base)) {
                for (Path directory : directories.filter(Files::isDirectory).toList()) {
                    String name = directory.getFileName().toString();
                    if (!name.startsWith(prefix)) {
                        continue;
                    }
                    try {
                        ids.add(Long.valueOf(name.substring(prefix.length())));
                    } catch (NumberFormatException ignored) {
                        // 忽略非标准目录名
                    }
                }
            } catch (IOException ex) {
                log.warn("列举本地离线仓库目录失败: base={}", base, ex);
            }
        }
        return List.copyOf(ids);
    }

    private boolean groupExistsInDb(Long groupId) {
        if (projectGroupMapper == null) {
            return true;
        }
        return projectGroupMapper.selectById(groupId) != null;
    }

    private void markDirty(@Nullable Long groupId) {
        if (groupId != null) {
            dirtyGroups.add(groupId);
            indexedGroups.remove(groupId);
        }
    }

    private void runInTransaction(Runnable action) {
        if (transactionTemplate != null) {
            transactionTemplate.executeWithoutResult(ignored -> action.run());
        } else {
            action.run();
        }
    }

    private boolean isParseOk(WbOfflineFlowIndex row) {
        return PARSE_STATUS_OK.equals(row.getParseStatus());
    }

    private IndexedFlowSnapshot toSnapshot(WbOfflineFlowIndex row) {
        return new IndexedFlowSnapshot(
                row.getId(),
                row.getGroupId(),
                row.getFlowPath(),
                row.getFlowId(),
                isParseOk(row),
                Boolean.TRUE.equals(row.getHasSchedule()),
                parseSchedulePeriod(row.getSchedulePeriod()),
                parseCrossGroupDependency(row.getCrossGroupDependency()),
                parseFailurePolicy(row.getFailurePolicy()),
                row.getScheduleCron(),
                row.getScheduleTimezone(),
                Boolean.TRUE.equals(row.getScheduleEnabled())
        );
    }

    @Nullable
    private OfflineSchedulePeriod parseSchedulePeriod(@Nullable String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return OfflineSchedulePeriod.valueOf(raw.trim().toUpperCase());
        } catch (IllegalArgumentException ex) {
            return null;
        }
    }

    private OfflineCrossGroupDependency parseCrossGroupDependency(@Nullable String raw) {
        if (raw == null || raw.isBlank()) {
            return OfflineCrossGroupDependency.ALLOW;
        }
        try {
            return OfflineCrossGroupDependency.valueOf(raw.trim().toUpperCase());
        } catch (IllegalArgumentException ex) {
            return OfflineCrossGroupDependency.ALLOW;
        }
    }

    private OfflineFailurePolicy parseFailurePolicy(@Nullable String raw) {
        if (raw == null || raw.isBlank()) {
            return OfflineFailurePolicy.CONTINUE;
        }
        try {
            return OfflineFailurePolicy.valueOf(raw.trim().toUpperCase());
        } catch (IllegalArgumentException ex) {
            return OfflineFailurePolicy.CONTINUE;
        }
    }

    private static FileStat readFileStat(@Nullable Path flowFile) {
        if (flowFile == null || !Files.isRegularFile(flowFile)) {
            return FileStat.EMPTY;
        }
        try {
            return new FileStat(Files.getLastModifiedTime(flowFile).toMillis(), Files.size(flowFile));
        } catch (IOException ex) {
            return FileStat.EMPTY;
        }
    }

    @Nullable
    private static String readStringIfRegularFile(@Nullable Path flowFile) {
        if (flowFile == null || !Files.isRegularFile(flowFile)) {
            return null;
        }
        try {
            return Files.readString(flowFile, StandardCharsets.UTF_8);
        } catch (IOException ex) {
            return null;
        }
    }

    @Nullable
    private String readGitBranch(Path repoPath) {
        return tryRunReadOnlyGit(repoPath, "symbolic-ref", "--short", "HEAD");
    }

    @Nullable
    private String readGitHead(Path repoPath) {
        return tryRunReadOnlyGit(repoPath, "rev-parse", "HEAD");
    }

    @Nullable
    private String tryRunReadOnlyGit(Path repoPath, String... args) {
        if (!Files.isDirectory(repoPath.resolve(".git"))) {
            return null;
        }
        List<String> command = new ArrayList<>();
        command.add("git");
        command.add("--no-optional-locks");
        command.add("-C");
        command.add(repoPath.toString());
        command.addAll(List.of(args));
        try {
            Process process = new ProcessBuilder(command).redirectErrorStream(true).start();
            if (!process.waitFor(GIT_READ_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                return null;
            }
            if (process.exitValue() != 0) {
                return null;
            }
            String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8).trim();
            return output.isBlank() ? null : output;
        } catch (IOException ex) {
            return null;
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            return null;
        }
    }

    static String normalizeFlowPath(String path) {
        return path.trim().replace('\\', '/').replaceAll("^/+", "");
    }

    static String normalizeFolderPrefix(String folderPath) {
        String normalized = normalizeFlowPath(folderPath).replaceAll("/+$", "");
        return normalized.isEmpty() ? "" : normalized + "/";
    }

    private record FileStat(long mtimeMs, long size) {
        private static final FileStat EMPTY = new FileStat(0L, 0L);
    }

    private record PendingUpsert(
            String flowPath,
            @Nullable String content,
            FileStat stat,
            @Nullable WbOfflineFlowIndex existing
    ) {
    }

    private record ParsedFlowProjection(
            String parseStatus,
            @Nullable String flowId,
            @Nullable Long ownerUserId,
            @Nullable OfflineFlowYamlSupport.ScheduleData schedule,
            OfflineCrossGroupDependency crossGroupDependency,
            OfflineFailurePolicy failurePolicy,
            List<OfflineFlowDependencyRef> dependencies
    ) {
        private static ParsedFlowProjection invalid() {
            return new ParsedFlowProjection(
                    PARSE_STATUS_INVALID,
                    null,
                    null,
                    null,
                    OfflineCrossGroupDependency.ALLOW,
                    OfflineFailurePolicy.CONTINUE,
                    List.of()
            );
        }

        private WbOfflineFlowIndex toEntity(Long groupId, String flowPath, FileStat stat) {
            WbOfflineFlowIndex entity = new WbOfflineFlowIndex();
            entity.setGroupId(groupId);
            entity.setFlowPath(flowPath);
            entity.setFlowId(flowId);
            entity.setOwnerUserId(ownerUserId);
            entity.setParseStatus(parseStatus);
            entity.setHasSchedule(schedule != null);
            entity.setScheduleEnabled(schedule != null && schedule.enabled());
            entity.setSchedulePeriod(schedule != null && schedule.period() != null ? schedule.period().name() : null);
            entity.setScheduleCron(schedule != null ? schedule.cron() : null);
            entity.setScheduleTimezone(schedule != null ? schedule.timezone() : null);
            entity.setCrossGroupDependency(crossGroupDependency.name());
            entity.setFailurePolicy(failurePolicy.name());
            entity.setDependencyCount(dependencies.size());
            entity.setFileMtimeMs(stat.mtimeMs());
            entity.setFileSize(stat.size());
            entity.setUpdatedAt(LocalDateTime.now());
            return entity;
        }
    }
}
