package com.wbdata.offline.service;

import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.dto.OfflineFlowContentResponse;
import com.wbdata.offline.dto.SaveOfflineFlowRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

@Service
@RequiredArgsConstructor
public class OfflineFlowContentService {

    private final OfflineProperties offlineProperties;
    private final RepoLockManager repoLockManager;
    private final OfflineKestraFlowFileService kestraFlowFileService;

    public OfflineFlowContentResponse getFlowContent(Long groupId, String path) {
        return repoLockManager.withLock(groupId, () -> getFlowContentUnlocked(groupId, path));
    }

    private OfflineFlowContentResponse getFlowContentUnlocked(Long groupId, String path) {
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        Path flowPath = resolveFlowPath(repoPath, path);
        try {
            return readFlowContent(groupId, path, flowPath);
        } catch (IOException ex) {
            throw new IllegalStateException("读取任务文件失败", ex);
        }
    }

    public OfflineFlowContentResponse saveFlowContent(SaveOfflineFlowRequest request) {
        return repoLockManager.withLock(request.groupId(), () -> saveFlowContentUnlocked(request));
    }

    private OfflineFlowContentResponse saveFlowContentUnlocked(SaveOfflineFlowRequest request) {
        Path repoPath = offlineProperties.resolveRepoPath(request.groupId());
        Path flowPath = resolveFlowPath(repoPath, request.path());
        try {
            boolean isNewFile = !Files.exists(flowPath);
            if (!isNewFile) {
                OfflineFlowContentResponse current = readFlowContent(request.groupId(), request.path(), flowPath);
                if (!current.contentHash().equals(request.contentHash())
                        || current.fileUpdatedAt() != request.fileUpdatedAt()) {
                    throw new ResponseStatusException(HttpStatus.CONFLICT, "检测到文件已被修改，请先加载最新内容");
                }
            }

            Files.createDirectories(flowPath.getParent());
            Files.writeString(flowPath, request.content(), StandardCharsets.UTF_8);
            kestraFlowFileService.syncFlowFile(repoPath, request.path());
            return readFlowContent(request.groupId(), request.path(), flowPath);
        } catch (IOException ex) {
            throw new IllegalStateException("保存任务文件失败", ex);
        }
    }

    private Path resolveFlowPath(Path repoPath, String path) {
        if (path == null || path.isBlank()) {
            throw new IllegalArgumentException("任务路径不能为空");
        }

        Path relativePath = Path.of(path).normalize();
        if (relativePath.isAbsolute() || !"flow.yaml".equals(relativePath.getFileName().toString())) {
            throw new IllegalArgumentException("任务路径不合法");
        }

        Path resolvedPath = repoPath.resolve(relativePath).normalize();
        if (!resolvedPath.startsWith(repoPath)) {
            throw new IllegalArgumentException("任务路径不合法");
        }
        return resolvedPath;
    }

    private OfflineFlowContentResponse readFlowContent(Long groupId, String path, Path flowPath) throws IOException {
        if (!Files.isRegularFile(flowPath)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "任务文件不存在");
        }

        String content = Files.readString(flowPath, StandardCharsets.UTF_8);
        long fileUpdatedAt = Files.getLastModifiedTime(flowPath).toMillis();
        return new OfflineFlowContentResponse(
                groupId,
                path,
                content,
                sha256Hex(content),
                fileUpdatedAt
        );
    }

    public void deleteFlow(Long groupId, String path) {
        repoLockManager.withLock(groupId, () -> deleteFlowUnlocked(groupId, path));
    }

    private void deleteFlowUnlocked(Long groupId, String path) {
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        Path flowDir = OfflineRepoPaths.resolveFlowDirectory(repoPath, path);
        Path scriptsDir = repoPath.resolve("scripts")
                .resolve(repoPath.resolve("_flows").relativize(flowDir));
        OfflineRepoPaths.assertNoSymlinks(repoPath, scriptsDir);

        try {
            // Delete the flow directory and its hierarchical scripts mirror.
            if (Files.exists(flowDir)) {
                deleteDirectory(flowDir);
            }
            if (Files.exists(scriptsDir)) {
                deleteDirectory(scriptsDir);
            }

            Files.deleteIfExists(kestraFlowFileService.resolveFlowFile(repoPath, path));
        } catch (IOException ex) {
            throw new IllegalStateException("删除任务失败", ex);
        }
    }

    public void moveFlow(Long groupId, String path, String newPath) {
        repoLockManager.withLock(groupId, () -> moveFlowUnlocked(groupId, path, newPath));
    }

    private void moveFlowUnlocked(Long groupId, String path, String newPath) {
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        Path flowDir = OfflineRepoPaths.resolveFlowDirectory(repoPath, path);
        Path newFlowDir = OfflineRepoPaths.resolveFlowDirectory(repoPath, newPath);
        try {
            OfflineRepoPaths.moveDirectory(repoPath, flowDir, newFlowDir, true, kestraFlowFileService);
        } catch (IOException ex) {
            throw new IllegalStateException("移动任务失败", ex);
        }
    }

    private void deleteDirectory(Path dir) throws IOException {
        try (var stream = Files.walk(dir)) {
            var files = stream.sorted((a, b) -> b.compareTo(a)).toList();
            for (Path file : files) {
                Files.delete(file);
            }
        }
    }

    private String sha256Hex(String content) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(content.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("计算内容哈希失败", ex);
        }
    }
}
