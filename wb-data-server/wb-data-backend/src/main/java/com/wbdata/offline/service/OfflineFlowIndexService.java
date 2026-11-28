package com.wbdata.offline.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.wbdata.group.entity.WbProjectGroup;
import com.wbdata.group.mapper.WbProjectGroupMapper;
import com.wbdata.offline.config.OfflineBranchContext;
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
import com.wbdata.offline.repo.service.GitWorktreeManager;
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
import java.util.Optional;
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
    private final Set<GroupBranchKey> indexedKeys = ConcurrentHashMap.newKeySet();
    private final Set<GroupBranchKey> dirtyKeys = ConcurrentHashMap.newKeySet();
    private final Object startupMonitor = new Object();
    private volatile boolean startupReconciled = false;
    @Nullable
    private GitWorktreeManager gitWorktreeManager;

    @Autowired(required = false)
    public void setGitWorktreeManager(@Nullable GitWorktreeManager gitWorktreeManager) {
        this.gitWorktreeManager = gitWorktreeManager;
    }

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
                    List<GitWorktreeManager.WorktreeInfo> worktrees = gitWorktreeManager != null
                            ? gitWorktreeManager.listActiveWorktrees(groupId)
                            : List.of();
                    if (worktrees.isEmpty()) {
                        reconcileGroup(groupId);
                        continue;
                    }
                    for (GitWorktreeManager.WorktreeInfo worktree : worktrees) {
                        if (worktree.branch() == null || worktree.branch().isBlank()) {
                            continue;
                        }
                        OfflineBranchContext.withWorkspace(groupId, worktree.branch(), worktree.path(),
                                () -> reconcileGroup(groupId));
                    }
                } catch (RuntimeException ex) {
                    log.warn("启动对账项目组离线任务索引失败，已标记待自愈: groupId={}, reason={}", groupId, ex.getMessage(), ex);
                    markDirty(groupId, resolveActiveBranch(groupId));
                }
            }
            startupReconciled = true;
        }
    }

    public void reconcileGroup(Long groupId) {
        if (!isEnabled() || groupId == null) {
            return;
        }
        String branch = resolveActiveBranch(groupId);
        repoLockManager.withLock(groupId, () -> {
            reconcileGroupUnlocked(groupId, branch);
            return null;
        });
    }

    public void onGroupRepoInitialized(Long groupId, String branch) {
        if (!isEnabled() || groupId == null) {
            return;
        }
        String normalizedBranch = normalizeBranchName(branch);
        try {
            if (!groupExistsInDb(groupId)) {
                return;
            }
            runInTransaction(() -> upsertRepoState(groupId, normalizedBranch, null, 0));
            GroupBranchKey key = new GroupBranchKey(groupId, normalizedBranch);
            dirtyKeys.remove(key);
            indexedKeys.add(key);
        } catch (RuntimeException ex) {
            log.error("初始化离线仓库索引状态失败: groupId={}, branch={}", groupId, normalizedBranch, ex);
            markDirty(groupId, normalizedBranch);
        }
    }

    public void onBranchDeleted(Long groupId, String branch) {
        if (!isEnabled() || groupId == null || branch == null || branch.isBlank()) {
            return;
        }
        String normalizedBranch = normalizeBranchName(branch);
        GroupBranchKey key = new GroupBranchKey(groupId, normalizedBranch);
        try {
            runInTransaction(() -> {
                indexMapper.deleteByGroupAndBranch(groupId, normalizedBranch);
                stateMapper.deleteByGroupAndBranch(groupId, normalizedBranch);
            });
            dirtyKeys.remove(key);
            indexedKeys.remove(key);
        } catch (RuntimeException ex) {
            log.warn("清理已删除分支索引失败: groupId={}, branch={}", groupId, normalizedBranch, ex);
            markDirty(groupId, normalizedBranch);
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
        String branch = resolveActiveBranch(groupId);
        try {
            FileStat stat = readFileStat(flowFile);
            runInTransaction(() -> upsertFlowUnlocked(groupId, branch, normalizedPath, yamlContent, stat));
        } catch (RuntimeException ex) {
            log.error("写通更新离线任务索引失败，已标记待自愈: groupId={}, branch={}, path={}", groupId, branch, normalizedPath, ex);
            markDirty(groupId, branch);
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
        String branch = resolveActiveBranch(groupId);
        try {
            runInTransaction(() -> {
                int removed = indexMapper.deleteByGroupAndBranchAndPath(groupId, branch, normalizedPath);
                if (removed > 0) {
                    adjustStateFlowCount(groupId, branch, -removed);
                }
            });
        } catch (RuntimeException ex) {
            log.error("删除离线任务索引失败，已标记待自愈: groupId={}, branch={}, path={}", groupId, branch, normalizedPath, ex);
            markDirty(groupId, branch);
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
        String branch = resolveActiveBranch(groupId);
        try {
            FileStat stat = readFileStat(newFlowFile);
            String diskContent = readStringIfRegularFile(newFlowFile);
            runInTransaction(() -> {
                WbOfflineFlowIndex targetExisting = indexMapper.findByGroupAndBranchAndPath(groupId, branch, newNormalized);
                if (targetExisting != null && targetExisting.getId() != null) {
                    indexMapper.deleteById(targetExisting.getId());
                }
                WbOfflineFlowIndex existing = indexMapper.findByGroupAndBranchAndPath(groupId, branch, oldNormalized);
                if (existing != null) {
                    existing.setBranch(branch);
                    existing.setFlowPath(newNormalized);
                    existing.setFileMtimeMs(stat.mtimeMs());
                    existing.setFileSize(stat.size());
                    existing.setUpdatedAt(LocalDateTime.now());
                    indexMapper.updateById(existing);
                    return;
                }
                if (diskContent != null) {
                    upsertFlowUnlocked(groupId, branch, newNormalized, diskContent, stat);
                }
            });
        } catch (RuntimeException ex) {
            log.error("移动离线任务索引失败，已标记待自愈: groupId={}, branch={}, oldPath={}, newPath={}",
                    groupId, branch, oldNormalized, newNormalized, ex);
            markDirty(groupId, branch);
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
        String branch = resolveActiveBranch(groupId);
        try {
            runInTransaction(() -> {
                int removed = indexMapper.deleteByGroupAndBranchAndPathPrefix(groupId, branch, prefix);
                if (removed > 0) {
                    adjustStateFlowCount(groupId, branch, -removed);
                }
            });
        } catch (RuntimeException ex) {
            log.error("删除文件夹离线任务索引失败，已标记待自愈: groupId={}, branch={}, folderPath={}", groupId, branch, folderPath, ex);
            markDirty(groupId, branch);
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
        String branch = resolveActiveBranch(groupId);
        try {
            List<WbOfflineFlowIndex> movingRows = indexMapper.findByGroupAndBranchAndPathPrefix(groupId, branch, oldPrefix);
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
                indexMapper.deleteByGroupAndBranchAndPathPrefix(groupId, branch, newPrefix);
                for (WbOfflineFlowIndex row : movingRows) {
                    String currentPath = row.getFlowPath();
                    if (currentPath == null || !currentPath.startsWith(oldPrefix)) {
                        continue;
                    }
                    String nextPath = newPrefix + currentPath.substring(oldPrefix.length());
                    FileStat stat = statsByNewPath.getOrDefault(nextPath, FileStat.EMPTY);
                    row.setBranch(branch);
                    row.setFlowPath(nextPath);
                    row.setFileMtimeMs(stat.mtimeMs());
                    row.setFileSize(stat.size());
                    row.setUpdatedAt(LocalDateTime.now());
                    indexMapper.updateById(row);
                }
            });
        } catch (RuntimeException ex) {
            log.error("移动文件夹离线任务索引失败，已标记待自愈: groupId={}, branch={}, old={}, new={}",
                    groupId, branch, oldPrefix, newPrefix, ex);
            markDirty(groupId, branch);
        }
    }

    public void ensureGroupIndexed(Long groupId) {
        if (!isEnabled() || groupId == null) {
            return;
        }
        String branch = resolveActiveBranch(groupId);
        ensureGroupBranchIndexed(groupId, branch);
    }

    private void ensureGroupBranchIndexed(Long groupId, String branch) {
        GroupBranchKey key = new GroupBranchKey(groupId, branch);
        if (indexedKeys.contains(key) && !dirtyKeys.contains(key)) {
            return;
        }
        repoLockManager.withLock(groupId, () -> {
            if (indexedKeys.contains(key) && !dirtyKeys.contains(key)) {
                return null;
            }
            if (startupReconciled && !dirtyKeys.contains(key) && stateMapper.findByGroupAndBranch(groupId, branch) != null) {
                indexedKeys.add(key);
                return null;
            }
            reconcileGroupUnlocked(groupId, branch);
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
        if (!dirtyKeys.isEmpty()) {
            for (GroupBranchKey dirty : List.copyOf(dirtyKeys)) {
                Optional<Path> worktree = gitWorktreeManager != null
                        ? gitWorktreeManager.findExistingWorktree(dirty.groupId(), dirty.branch())
                        : Optional.empty();
                if (worktree.isPresent()) {
                    OfflineBranchContext.withWorkspace(dirty.groupId(), dirty.branch(), worktree.get(),
                            () -> reconcileGroup(dirty.groupId()));
                } else {
                    reconcileGroup(dirty.groupId());
                }
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
        String branch = resolveActiveBranch(groupId);
        ensureGroupBranchIndexed(groupId, branch);
        List<WbOfflineFlowIndex> rows = indexMapper.findByGroupAndBranch(groupId, branch);
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
        String branch = resolveActiveBranch(groupId);
        return listFlowsByGroupAndBranchAndOwner(groupId, branch, ownerUserId);
    }

    public List<WbOfflineFlowIndex> listFlowsByGroupAndBranchAndOwner(Long groupId, String branch, Long ownerUserId) {
        if (!isEnabled() || groupId == null || ownerUserId == null) {
            return List.of();
        }
        String normalizedBranch = normalizeBranchName(branch);
        ensureGroupBranchIndexed(groupId, normalizedBranch);
        List<WbOfflineFlowIndex> rows = indexMapper.findByGroupAndBranchAndOwnerUserId(groupId, normalizedBranch, ownerUserId);
        return rows == null ? List.of() : rows;
    }

    public List<WbOfflineFlowIndex> listFlowsByGroupAndOwnerAllBranches(Long groupId, Long ownerUserId) {
        if (!isEnabled() || groupId == null || ownerUserId == null) {
            return List.of();
        }
        ensureGroupIndexed(groupId);
        List<WbOfflineFlowIndex> rows = indexMapper.findByGroupAndOwnerUserId(groupId, ownerUserId);
        return rows == null ? List.of() : rows;
    }

    public Map<String, Long> findFlowOwnersByGroupAndBranches(Long groupId, Map<String, Set<String>> flowIdsByBranch) {
        if (!isEnabled() || groupId == null || flowIdsByBranch == null || flowIdsByBranch.isEmpty()) {
            return Map.of();
        }
        Map<String, Long> result = new LinkedHashMap<>();
        Set<String> unresolved = new LinkedHashSet<>();
        for (Map.Entry<String, Set<String>> entry : flowIdsByBranch.entrySet()) {
            Set<String> flowIds = entry.getValue();
            if (flowIds == null || flowIds.isEmpty()) {
                continue;
            }
            String branchKey = entry.getKey() == null || entry.getKey().isBlank()
                    ? OfflineBranchContext.MAIN_BRANCH
                    : normalizeBranchName(entry.getKey());
            ensureGroupBranchIndexed(groupId, branchKey);
            List<WbOfflineFlowIndex> rows = indexMapper.findByGroupAndBranchAndFlowIds(
                    groupId, branchKey, List.copyOf(flowIds));
            if (rows != null) {
                for (WbOfflineFlowIndex row : rows) {
                    if (row != null && row.getFlowId() != null && row.getOwnerUserId() != null) {
                        result.putIfAbsent(branchKey + "::" + row.getFlowId(), row.getOwnerUserId());
                        result.putIfAbsent(row.getFlowId(), row.getOwnerUserId());
                    }
                }
            }
            for (String flowId : flowIds) {
                if (!result.containsKey(branchKey + "::" + flowId)) {
                    unresolved.add(flowId);
                }
            }
        }
        if (!unresolved.isEmpty()) {
            List<WbOfflineFlowIndex> fallbackRows = indexMapper.findByGroupAndFlowIds(groupId, List.copyOf(unresolved));
            if (fallbackRows != null) {
                for (WbOfflineFlowIndex row : fallbackRows) {
                    if (row != null && row.getFlowId() != null && row.getOwnerUserId() != null) {
                        result.putIfAbsent(row.getFlowId(), row.getOwnerUserId());
                    }
                }
            }
        }
        return result;
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
        List<IndexedFlowSnapshot> snapshots = new ArrayList<>();
        for (Long groupId : distinctGroupIds) {
            String branch = resolveActiveBranch(groupId);
            ensureGroupBranchIndexed(groupId, branch);
            indexMapper.findByGroupAndBranch(groupId, branch).stream()
                    .filter(this::isParseOk)
                    .map(this::toSnapshot)
                    .forEach(snapshots::add);
        }
        return snapshots;
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
            Long targetGroupId = entry.getKey();
            String targetBranch = resolveActiveBranch(targetGroupId);
            ensureGroupBranchIndexed(targetGroupId, targetBranch);
            List<WbOfflineFlowIndex> rows = indexMapper.findByGroupAndBranchAndFlowIds(
                    targetGroupId, targetBranch, List.copyOf(entry.getValue()));
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
        String branch = resolveActiveBranch(groupId);
        ensureGroupBranchIndexed(groupId, branch);
        List<WbOfflineFlowIndex> rows = indexMapper.findByGroupAndBranchAndFlowId(groupId, branch, flowId);
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
        String branch = resolveActiveBranch(groupId);
        ensureGlobalIndexReady();
        List<WbOfflineFlowIndex> folderFlows = indexMapper.findByGroupAndBranchAndPathPrefix(groupId, branch, prefix);
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
                .filter(row -> !Objects.equals(row.getGroupId(), groupId)
                        || Objects.equals(normalizeBranchName(row.getBranch()), branch))
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

    private void reconcileGroupUnlocked(Long groupId, String targetBranch) {
        String normalizedBranch = normalizeBranchName(targetBranch);
        GroupBranchKey key = new GroupBranchKey(groupId, normalizedBranch);
        if (!groupExistsInDb(groupId)) {
            dirtyKeys.remove(key);
            return;
        }
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        Path flowsDir = repoPath.resolve("_flows");
        Map<String, Path> diskFlows = collectDiskFlows(repoPath, flowsDir);
        List<WbOfflineFlowIndex> existingRows = indexMapper.findByGroupAndBranch(groupId, normalizedBranch);
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

        String gitBranch = readGitBranch(repoPath);
        String effectiveBranch = gitBranch != null ? normalizeBranchName(gitBranch) : normalizedBranch;
        String headSha = readGitHead(repoPath);
        int flowCount = diskFlows.size();

        runInTransaction(() -> {
            for (WbOfflineFlowIndex row : toDelete) {
                if (row.getId() != null) {
                    indexMapper.deleteById(row.getId());
                }
            }
            for (PendingUpsert pending : toUpsert) {
                persistParsedFlow(groupId, normalizedBranch, pending.flowPath(), pending.content(), pending.stat(), pending.existing());
            }
            upsertRepoState(groupId, normalizedBranch, effectiveBranch, headSha, flowCount);
        });

        dirtyKeys.remove(key);
        indexedKeys.add(key);
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

    private void upsertFlowUnlocked(Long groupId, String branch, String normalizedPath, String yamlContent, FileStat stat) {
        WbOfflineFlowIndex existing = indexMapper.findByGroupAndBranchAndPath(groupId, branch, normalizedPath);
        persistParsedFlow(groupId, branch, normalizedPath, yamlContent, stat, existing);
        if (existing == null) {
            adjustStateFlowCount(groupId, branch, 1);
        }
    }

    private void persistParsedFlow(Long groupId,
                                   String branch,
                                   String normalizedPath,
                                   @Nullable String yamlContent,
                                   FileStat stat,
                                   @Nullable WbOfflineFlowIndex existing) {
        ParsedFlowProjection parsed = parseForProjection(yamlContent);
        WbOfflineFlowIndex entity = parsed.toEntity(groupId, branch, normalizedPath, stat);
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

    private void adjustStateFlowCount(Long groupId, String branch, int delta) {
        stateMapper.adjustFlowCount(groupId, branch, delta, LocalDateTime.now());
    }

    private void upsertRepoState(Long groupId, String branchKey, @Nullable String syncedBranch, @Nullable String headSha, int flowCount) {
        WbOfflineRepoIndexState state = new WbOfflineRepoIndexState();
        state.setGroupId(groupId);
        state.setBranch(branchKey);
        state.setSyncedBranch(syncedBranch);
        state.setSyncedHeadSha(headSha);
        state.setFlowCount(flowCount);
        state.setIndexedAt(LocalDateTime.now());
        stateMapper.upsertState(state);
    }

    private void upsertRepoState(Long groupId, @Nullable String branch, @Nullable String headSha, int flowCount) {
        String normalized = normalizeBranchName(branch);
        upsertRepoState(groupId, normalized, branch, headSha, flowCount);
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
                    if (!name.startsWith(prefix) || name.endsWith("-worktrees")) {
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

    private void markDirty(@Nullable Long groupId, @Nullable String branch) {
        if (groupId != null) {
            GroupBranchKey key = new GroupBranchKey(groupId, normalizeBranchName(branch));
            dirtyKeys.add(key);
            indexedKeys.remove(key);
        }
    }

    private String resolveActiveBranch(Long groupId) {
        String contextBranch = OfflineBranchContext.currentBranch(groupId);
        if (contextBranch != null && !contextBranch.isBlank()) {
            return normalizeBranchName(contextBranch);
        }
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        String diskBranch = readGitBranch(repoPath);
        return normalizeBranchName(diskBranch);
    }

    private static String normalizeBranchName(@Nullable String branch) {
        if (branch == null) {
            return OfflineBranchContext.MAIN_BRANCH;
        }
        String trimmed = branch.trim();
        if (trimmed.isEmpty()) {
            return OfflineBranchContext.MAIN_BRANCH;
        }
        return trimmed.length() > 191 ? trimmed.substring(0, 191) : trimmed;
    }

    private record GroupBranchKey(Long groupId, String branch) {
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
        if (!OfflineProperties.isGitRepoInitialized(repoPath)) {
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

        private WbOfflineFlowIndex toEntity(Long groupId, String branch, String flowPath, FileStat stat) {
            WbOfflineFlowIndex entity = new WbOfflineFlowIndex();
            entity.setGroupId(groupId);
            entity.setBranch(branch);
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
