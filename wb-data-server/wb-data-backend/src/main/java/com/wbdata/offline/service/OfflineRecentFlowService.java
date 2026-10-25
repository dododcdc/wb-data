package com.wbdata.offline.service;

import com.wbdata.offline.entity.WbOfflineRecentFlow;
import com.wbdata.offline.mapper.WbOfflineRecentFlowMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.lang.Nullable;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@Service
public class OfflineRecentFlowService {

    public static final int MAX_RECENT_FLOWS = 5;
    public static final String RESERVED_RECENT_DIRECTORY_NAME = "最近操作";

    @Nullable
    private final WbOfflineRecentFlowMapper recentFlowMapper;

    @Autowired
    public OfflineRecentFlowService(@Nullable WbOfflineRecentFlowMapper recentFlowMapper) {
        this.recentFlowMapper = recentFlowMapper;
    }

    public List<String> listRecentFlowPaths(Long userId, Long groupId) {
        if (recentFlowMapper == null || userId == null || groupId == null) {
            return List.of();
        }
        return recentFlowMapper.findByUserAndGroup(userId, groupId).stream()
                .map(WbOfflineRecentFlow::getFlowPath)
                .filter(path -> path != null && !path.isBlank())
                .distinct()
                .limit(MAX_RECENT_FLOWS)
                .toList();
    }

    public void recordRecentFlow(Long userId, Long groupId, String flowPath) {
        if (recentFlowMapper == null || userId == null || groupId == null || flowPath == null || flowPath.isBlank()) {
            return;
        }
        String normalized = normalizeFlowPath(flowPath);
        if (normalized.isEmpty()) {
            return;
        }
        recentFlowMapper.deleteByUserGroupAndPath(userId, groupId, normalized);
        WbOfflineRecentFlow entity = new WbOfflineRecentFlow();
        entity.setUserId(userId);
        entity.setGroupId(groupId);
        entity.setFlowPath(normalized);
        entity.setAccessedAt(LocalDateTime.now());
        recentFlowMapper.insert(entity);

        List<WbOfflineRecentFlow> rows = recentFlowMapper.findByUserAndGroup(userId, groupId);
        for (int index = MAX_RECENT_FLOWS; index < rows.size(); index++) {
            WbOfflineRecentFlow overflow = rows.get(index);
            if (overflow.getId() != null) {
                recentFlowMapper.deleteById(overflow.getId());
            }
        }
    }

    public void onFlowDeleted(Long groupId, String flowPath) {
        if (recentFlowMapper == null || groupId == null || flowPath == null || flowPath.isBlank()) {
            return;
        }
        recentFlowMapper.deleteByGroupAndPath(groupId, normalizeFlowPath(flowPath));
    }

    public void onFlowMoved(Long groupId, String oldFlowPath, String newFlowPath) {
        if (recentFlowMapper == null || groupId == null
                || oldFlowPath == null || oldFlowPath.isBlank()
                || newFlowPath == null || newFlowPath.isBlank()) {
            return;
        }
        String oldNormalized = normalizeFlowPath(oldFlowPath);
        String newNormalized = normalizeFlowPath(newFlowPath);
        if (oldNormalized.equals(newNormalized)) {
            return;
        }
        List<WbOfflineRecentFlow> rows = recentFlowMapper.findByGroup(groupId);
        Set<String> existingUserPaths = collectUserPathKeys(rows);
        for (WbOfflineRecentFlow row : rows) {
            if (!oldNormalized.equals(row.getFlowPath()) || row.getId() == null) {
                continue;
            }
            String targetKey = userPathKey(row.getUserId(), newNormalized);
            if (existingUserPaths.contains(targetKey)) {
                recentFlowMapper.deleteById(row.getId());
            } else {
                recentFlowMapper.updateFlowPathById(row.getId(), newNormalized);
                existingUserPaths.remove(userPathKey(row.getUserId(), oldNormalized));
                existingUserPaths.add(targetKey);
            }
        }
    }

    public void onFolderDeleted(Long groupId, String folderPath) {
        if (recentFlowMapper == null || groupId == null || folderPath == null || folderPath.isBlank()) {
            return;
        }
        String prefix = normalizeFolderPrefix(folderPath);
        if (prefix.isEmpty()) {
            return;
        }
        for (WbOfflineRecentFlow row : recentFlowMapper.findByGroup(groupId)) {
            if (row.getId() != null && row.getFlowPath() != null && row.getFlowPath().startsWith(prefix)) {
                recentFlowMapper.deleteById(row.getId());
            }
        }
    }

    public void onFolderMoved(Long groupId, String oldFolderPath, String newFolderPath) {
        if (recentFlowMapper == null || groupId == null
                || oldFolderPath == null || oldFolderPath.isBlank()
                || newFolderPath == null || newFolderPath.isBlank()) {
            return;
        }
        String oldPrefix = normalizeFolderPrefix(oldFolderPath);
        String newPrefix = normalizeFolderPrefix(newFolderPath);
        if (oldPrefix.isEmpty() || newPrefix.isEmpty() || oldPrefix.equals(newPrefix)) {
            return;
        }
        List<WbOfflineRecentFlow> rows = recentFlowMapper.findByGroup(groupId);
        Set<String> existingUserPaths = collectUserPathKeys(rows);
        for (WbOfflineRecentFlow row : rows) {
            String currentPath = row.getFlowPath();
            if (row.getId() == null || currentPath == null || !currentPath.startsWith(oldPrefix)) {
                continue;
            }
            String rewritten = newPrefix + currentPath.substring(oldPrefix.length());
            String targetKey = userPathKey(row.getUserId(), rewritten);
            if (existingUserPaths.contains(targetKey)) {
                recentFlowMapper.deleteById(row.getId());
            } else {
                recentFlowMapper.updateFlowPathById(row.getId(), rewritten);
                existingUserPaths.remove(userPathKey(row.getUserId(), currentPath));
                existingUserPaths.add(targetKey);
            }
        }
    }

    static void assertNotReservedRootPath(java.nio.file.Path repoPath, java.nio.file.Path resolvedPath) {
        java.nio.file.Path reservedRoot = repoPath.resolve("_flows").resolve(RESERVED_RECENT_DIRECTORY_NAME).normalize();
        if (resolvedPath.normalize().startsWith(reservedRoot)) {
            throw new IllegalArgumentException("“" + RESERVED_RECENT_DIRECTORY_NAME + "”为系统保留名称");
        }
    }

    private static String normalizeFlowPath(String path) {
        return path.trim().replace('\\', '/').replaceAll("^/+", "");
    }

    private static String normalizeFolderPrefix(String folderPath) {
        String normalized = normalizeFlowPath(folderPath).replaceAll("/+$", "");
        return normalized.isEmpty() ? "" : normalized + "/";
    }

    private static Set<String> collectUserPathKeys(List<WbOfflineRecentFlow> rows) {
        Set<String> keys = new HashSet<>();
        for (WbOfflineRecentFlow row : rows) {
            if (row.getUserId() != null && row.getFlowPath() != null) {
                keys.add(userPathKey(row.getUserId(), row.getFlowPath()));
            }
        }
        return keys;
    }

    private static String userPathKey(Long userId, String flowPath) {
        return userId + ":" + flowPath;
    }
}
