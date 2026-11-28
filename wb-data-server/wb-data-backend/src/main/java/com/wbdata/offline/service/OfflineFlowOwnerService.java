package com.wbdata.offline.service;

import com.wbdata.auth.context.GroupAuthContext;
import com.wbdata.group.dto.AssetOwnerSummaryResponse;
import com.wbdata.group.dto.GroupOwnerInfo;
import com.wbdata.group.dto.TransferOwnerResponse;
import com.wbdata.group.service.GroupOwnerService;
import com.wbdata.offline.config.OfflineBranchContext;
import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.dto.TransferOfflineFlowOwnerRequest;
import com.wbdata.offline.entity.WbOfflineFlowIndex;
import com.wbdata.offline.repo.service.GitWorktreeManager;
import com.wbdata.offline.repo.service.RepoLockManager;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.lang.Nullable;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;

@Service
@RequiredArgsConstructor
public class OfflineFlowOwnerService {

    private final OfflineProperties offlineProperties;
    private final RepoLockManager repoLockManager;
    private final OfflineKestraFlowFileService kestraFlowFileService;
    private final OfflineFlowIndexService offlineFlowIndexService;
    private final GroupOwnerService groupOwnerService;
    private final OfflineFlowYamlSupport yamlSupport = new OfflineFlowYamlSupport();
    @Nullable
    private GitWorktreeManager gitWorktreeManager;

    @Autowired(required = false)
    public void setGitWorktreeManager(@Nullable GitWorktreeManager gitWorktreeManager) {
        this.gitWorktreeManager = gitWorktreeManager;
    }

    public List<AssetOwnerSummaryResponse> listFlowOwners(Long groupId) {
        Map<String, WbOfflineFlowIndex> flows = offlineFlowIndexService.listGroupFlowMap(groupId);
        if (flows.isEmpty()) {
            return List.of();
        }
        Map<Long, Long> counts = new LinkedHashMap<>();
        for (WbOfflineFlowIndex row : flows.values()) {
            if (row != null && row.getOwnerUserId() != null) {
                counts.merge(row.getOwnerUserId(), 1L, Long::sum);
            }
        }
        return groupOwnerService.summarizeOwners(groupId, counts);
    }

    public TransferOwnerResponse transferFlowOwners(Long groupId,
                                                      TransferOfflineFlowOwnerRequest request,
                                                      GroupAuthContext context) {
        if (request == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "转移参数不能为空");
        }
        boolean hasPaths = request.paths() != null && !request.paths().isEmpty();
        boolean hasFromOwner = request.fromOwnerUserId() != null;
        if (hasPaths == hasFromOwner) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "请指定待转移的任务路径或原负责人");
        }
        GroupOwnerInfo target = groupOwnerService.requireAssignableOwner(groupId, request.targetOwnerUserId());
        Long operatorId = context != null && context.user() != null ? context.user().id() : null;
        boolean canManageOthers = operatorId != null && groupOwnerService.canManageOthersOwnership(groupId, operatorId);

        if (hasFromOwner) {
            if (Objects.equals(request.fromOwnerUserId(), request.targetOwnerUserId())) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "目标负责人不能与原负责人相同");
            }
            if (!canManageOthers && !Objects.equals(request.fromOwnerUserId(), operatorId)) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "仅项目组管理员或系统管理员可批量移交他人的任务");
            }
            return transferByOwnerUnlockedSafe(groupId, request.fromOwnerUserId(), target);
        }

        List<String> targetPaths = normalizePaths(request.paths());
        if (targetPaths.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "请选择至少一个有效任务");
        }

        int updatedCount = repoLockManager.withLock(groupId, () -> {
            Path repoPath = offlineProperties.resolveRepoPath(groupId);
            List<PendingUpdate> updates = new ArrayList<>(targetPaths.size());
            for (String flowPath : targetPaths) {
                Path flowFile = resolveValidatedFlowFile(repoPath, flowPath);
                if (!Files.isRegularFile(flowFile)) {
                    throw new ResponseStatusException(HttpStatus.NOT_FOUND, "任务文件不存在: " + flowPath);
                }
                String content = readFile(flowFile);
                Long currentOwner = yamlSupport.readOwnerUserId(content);
                if (!canManageOthers && currentOwner != null && !Objects.equals(currentOwner, operatorId)) {
                    throw new ResponseStatusException(HttpStatus.FORBIDDEN, "仅负责人本人或项目组管理员可转移该任务负责人");
                }
                if (Objects.equals(currentOwner, target.userId())) {
                    continue;
                }
                updates.add(new PendingUpdate(flowPath, flowFile, content));
            }
            applyUpdates(repoPath, groupId, updates, target.userId());
            return updates.size();
        });

        return new TransferOwnerResponse(updatedCount, target.userId(), target.effectiveName());
    }

    public TransferOwnerResponse transferAllFromOwnerInternal(Long groupId,
                                                              Long fromOwnerUserId,
                                                              Long targetOwnerUserId) {
        if (fromOwnerUserId == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "原负责人不能为空");
        }
        if (Objects.equals(fromOwnerUserId, targetOwnerUserId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "目标负责人不能与原负责人相同");
        }
        GroupOwnerInfo target = groupOwnerService.requireAssignableOwner(groupId, targetOwnerUserId);
        List<GitWorktreeManager.WorktreeInfo> worktrees = gitWorktreeManager != null
                ? gitWorktreeManager.listActiveWorktrees(groupId)
                : List.of();
        if (worktrees.isEmpty()) {
            return transferByOwnerUnlockedSafe(groupId, fromOwnerUserId, target);
        }
        LinkedHashSet<String> updatedFlowPaths = new LinkedHashSet<>();
        repoLockManager.withLock(groupId, () -> {
            for (GitWorktreeManager.WorktreeInfo worktree : worktrees) {
                OfflineBranchContext.withWorkspace(groupId, worktree.branch(), worktree.path(), () -> {
                    updatedFlowPaths.addAll(transferByOwnerInCurrentWorkspace(groupId, fromOwnerUserId, target));
                });
            }
            return null;
        });
        return new TransferOwnerResponse(updatedFlowPaths.size(), target.userId(), target.effectiveName());
    }

    private TransferOwnerResponse transferByOwnerUnlockedSafe(Long groupId,
                                                              Long fromOwnerUserId,
                                                              GroupOwnerInfo target) {
        int updatedCount = repoLockManager.withLock(groupId,
                () -> transferByOwnerInCurrentWorkspace(groupId, fromOwnerUserId, target).size());
        return new TransferOwnerResponse(updatedCount, target.userId(), target.effectiveName());
    }

    private List<String> transferByOwnerInCurrentWorkspace(Long groupId,
                                                           Long fromOwnerUserId,
                                                           GroupOwnerInfo target) {
        List<WbOfflineFlowIndex> indexedFlows = offlineFlowIndexService.listFlowsByGroupAndOwner(groupId, fromOwnerUserId);
        if (indexedFlows.isEmpty()) {
            return List.of();
        }
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        List<PendingUpdate> updates = new ArrayList<>(indexedFlows.size());
        for (WbOfflineFlowIndex row : indexedFlows) {
            if (row.getFlowPath() == null || row.getFlowPath().isBlank()) {
                continue;
            }
            String flowPath = OfflineFlowIndexService.normalizeFlowPath(row.getFlowPath());
            Path flowFile = resolveValidatedFlowFile(repoPath, flowPath);
            if (!Files.isRegularFile(flowFile)) {
                continue;
            }
            updates.add(new PendingUpdate(flowPath, flowFile, readFile(flowFile)));
        }
        applyUpdates(repoPath, groupId, updates, target.userId());
        return updates.stream().map(PendingUpdate::flowPath).toList();
    }

    private void applyUpdates(Path repoPath, Long groupId, List<PendingUpdate> updates, Long targetOwnerUserId) {
        for (PendingUpdate update : updates) {
            String updatedYaml = yamlSupport.applyOwnerUserIdLabel(update.content(), targetOwnerUserId);
            writeFile(update.flowFile(), updatedYaml);
            try {
                kestraFlowFileService.syncFlowFile(repoPath, update.flowPath());
            } catch (IOException ex) {
                throw new IllegalStateException("同步 Kestra 任务文件失败", ex);
            }
            offlineFlowIndexService.onFlowSaved(groupId, update.flowPath(), updatedYaml, update.flowFile());
        }
    }

    private List<String> normalizePaths(List<String> rawPaths) {
        LinkedHashSet<String> normalized = new LinkedHashSet<>();
        for (String path : rawPaths) {
            if (path == null || path.isBlank()) {
                continue;
            }
            normalized.add(OfflineFlowIndexService.normalizeFlowPath(path));
        }
        return List.copyOf(normalized);
    }

    private Path resolveValidatedFlowFile(Path repoPath, String path) {
        Path relative = Path.of(path).normalize();
        if (relative.isAbsolute() || !"flow.yaml".equals(relative.getFileName().toString())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "任务路径不合法: " + path);
        }
        Path resolved = repoPath.resolve(relative).normalize();
        if (!resolved.startsWith(repoPath)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "任务路径不合法: " + path);
        }
        return resolved;
    }

    private static String readFile(Path file) {
        try {
            return Files.readString(file, StandardCharsets.UTF_8);
        } catch (IOException ex) {
            throw new IllegalStateException("读取任务文件失败", ex);
        }
    }

    private static void writeFile(Path file, String content) {
        try {
            Files.writeString(file, content, StandardCharsets.UTF_8);
        } catch (IOException ex) {
            throw new IllegalStateException("写入任务文件失败", ex);
        }
    }

    private record PendingUpdate(String flowPath, Path flowFile, String content) {
    }
}
