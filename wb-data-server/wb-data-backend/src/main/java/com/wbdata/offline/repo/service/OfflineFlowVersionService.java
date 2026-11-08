package com.wbdata.offline.repo.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.wbdata.git.entity.WbGitSyncConfig;
import com.wbdata.git.entity.WbOfflinePublishRecord;
import com.wbdata.git.mapper.WbGitSyncConfigMapper;
import com.wbdata.git.mapper.WbOfflinePublishRecordMapper;
import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.dto.OfflineFlowPublicationItem;
import com.wbdata.offline.dto.OfflineFlowVersionHistoryResponse;
import com.wbdata.offline.dto.OfflineFlowVersionItem;
import com.wbdata.offline.service.OfflineFlowDocumentService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
public class OfflineFlowVersionService extends GitRepositoryOperations {

    private final OfflineFlowDocumentService flowDocumentService;
    private final WbOfflinePublishRecordMapper publishRecordMapper;
    private final WbGitSyncConfigMapper syncConfigMapper;
    private final RepoLockManager repoLockManager;

    public OfflineFlowVersionService(OfflineProperties offlineProperties,
                                     OfflineFlowDocumentService flowDocumentService,
                                     WbOfflinePublishRecordMapper publishRecordMapper,
                                     WbGitSyncConfigMapper syncConfigMapper,
                                     RepoLockManager repoLockManager) {
        super(offlineProperties);
        this.flowDocumentService = flowDocumentService;
        this.publishRecordMapper = publishRecordMapper;
        this.syncConfigMapper = syncConfigMapper;
        this.repoLockManager = repoLockManager;
    }

    public OfflineFlowVersionHistoryResponse getVersions(Long groupId, String path, boolean onlineOnly, int page, int size) {
        if (page < 1 || size < 1 || size > 100) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "分页参数不合法");
        }
        return repoLockManager.withLock(groupId, () -> getVersionsLocked(groupId, path, onlineOnly, page, size));
    }

    private OfflineFlowVersionHistoryResponse getVersionsLocked(Long groupId, String path, boolean onlineOnly, int page, int size) {
        Path repoPath = repoPath(groupId);
        List<String> historyPaths = historyPaths(groupId, path, repoPath);
        List<CommitInfo> commits = readCommits(repoPath, null, historyPaths, false);
        Map<String, List<OfflineFlowPublicationItem>> publications = publications(groupId, repoPath, historyPaths);
        List<OfflineFlowVersionItem> commitItems = commits.stream()
                .filter(commit -> !onlineOnly || publications.containsKey(commit.sha()))
                .map(commit -> new OfflineFlowVersionItem(
                        commit.sha(), "COMMIT", commit.message(), commit.authorName(), commit.committedAt(),
                        false, publications.getOrDefault(commit.sha(), List.of())))
                .toList();

        long total = commitItems.size();
        int fromIndex = Math.min((page - 1) * size, commitItems.size());
        int toIndex = Math.min(fromIndex + size, commitItems.size());
        List<OfflineFlowVersionItem> items = new ArrayList<>();
        if (!onlineOnly && page == 1) {
            List<String> statusArgs = new ArrayList<>(List.of("status", "--porcelain", "--"));
            statusArgs.addAll(historyPaths);
            boolean dirty = !runGit(repoPath, statusArgs.toArray(String[]::new)).isBlank();
            items.add(new OfflineFlowVersionItem("WORKTREE", "DEVELOPMENT", null, null, null, dirty, List.of()));
        }
        items.addAll(commitItems.subList(fromIndex, toIndex));
        return new OfflineFlowVersionHistoryResponse(getCurrentBranch(repoPath), List.copyOf(items), total, page, size);
    }

    private Map<String, List<OfflineFlowPublicationItem>> publications(Long groupId, Path repoPath, List<String> historyPaths) {
        WbGitSyncConfig syncConfig = syncConfigMapper.selectOne(new LambdaQueryWrapper<WbGitSyncConfig>()
                .eq(WbGitSyncConfig::getGroupId, groupId)
                .eq(WbGitSyncConfig::getBranch, getCurrentBranch(repoPath)));
        List<WbOfflinePublishRecord> records = publishRecordMapper.selectList(new LambdaQueryWrapper<WbOfflinePublishRecord>()
                .eq(WbOfflinePublishRecord::getGroupId, groupId)
                .eq(WbOfflinePublishRecord::getBranch, getCurrentBranch(repoPath))
                .eq(WbOfflinePublishRecord::getSyncEnabledAtPush, true)
                .orderByAsc(WbOfflinePublishRecord::getPushedAt)
                .orderByAsc(WbOfflinePublishRecord::getCreatedAt)
                .orderByAsc(WbOfflinePublishRecord::getId));
        Map<String, List<OfflineFlowPublicationItem>> result = new LinkedHashMap<>();
        int onlineVersion = 0;
        for (WbOfflinePublishRecord record : records) {
            String revision = record.getBeforeSha() == null
                    ? record.getAfterSha()
                    : record.getBeforeSha() + ".." + record.getAfterSha();
            List<CommitInfo> related = readCommits(repoPath, revision, historyPaths, true);
            if (related.isEmpty()) {
                continue;
            }
            String attributedSha = revisionTouchesTask(repoPath, record.getAfterSha(), historyPaths)
                    ? record.getAfterSha()
                    : related.getFirst().sha();
            onlineVersion++;
            boolean currentOnline = syncConfig != null
                    && "CONFIRMED".equals(syncConfig.getDeploymentEvidence())
                    && record.getAfterSha().equals(syncConfig.getLastDeployedSha());
            result.computeIfAbsent(attributedSha, ignored -> new ArrayList<>())
                    .add(new OfflineFlowPublicationItem(
                            record.getId(), onlineVersion, record.getAfterSha(), record.getPushedAt(),
                            record.getSyncStatus(), currentOnline));
        }
        return result;
    }

    private boolean revisionTouchesTask(Path repoPath, String revision, List<String> paths) {
        List<String> args = new ArrayList<>(List.of("diff-tree", "--no-commit-id", "--name-only", "-r", revision, "--"));
        args.addAll(paths);
        return !runGit(repoPath, args.toArray(String[]::new)).isBlank();
    }

    private List<CommitInfo> readCommits(Path repoPath, String revision, List<String> paths, boolean firstOnly) {
        List<String> args = new ArrayList<>(List.of(
                "log", "--full-history", "--topo-order", "--format=%H%x1f%an%x1f%ct%x1f%s"));
        if (firstOnly) {
            args.add("-1");
        }
        if (revision != null) {
            args.add(revision);
        }
        args.add("--");
        args.addAll(paths);
        String output = runGit(repoPath, args.toArray(String[]::new));
        if (output.isBlank()) {
            return List.of();
        }
        return output.lines().map(line -> {
            String[] parts = line.split("\\x1f", 4);
            return new CommitInfo(parts[0], parts[1], Instant.ofEpochSecond(Long.parseLong(parts[2])), parts[3]);
        }).toList();
    }

    private List<String> historyPaths(Long groupId, String flowPath, Path repoPath) {
        Path normalized = Path.of(flowPath).normalize();
        String value = normalized.toString().replace('\\', '/');
        if (normalized.isAbsolute() || value.contains("..") || !value.startsWith("_flows/") || !value.endsWith("/flow.yaml")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "任务路径不合法");
        }
        Path taskDirectory = normalized.getParent();
        Set<String> paths = new LinkedHashSet<>();
        String taskDirectoryValue = taskDirectory.toString().replace('\\', '/');
        String scriptTaskDirectory = taskDirectoryValue.substring("_flows/".length());
        paths.add(value);
        paths.add(taskDirectoryValue);
        paths.add("scripts/" + scriptTaskDirectory);
        paths.add("transfers/" + taskDirectory.getFileName());
        paths.addAll(flowDocumentService.resolveManagedFiles(groupId, flowPath));
        return List.copyOf(paths);
    }

    private record CommitInfo(String sha, String authorName, Instant committedAt, String message) {
    }
}
