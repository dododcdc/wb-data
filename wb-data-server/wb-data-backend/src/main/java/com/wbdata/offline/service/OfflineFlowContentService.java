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
        Path flowPath = resolveFlowPath(repoPath, path);
        Path flowDir = flowPath.getParent();
        if (flowDir == null || !flowDir.startsWith(repoPath)) {
            throw new IllegalArgumentException("任务路径不合法");
        }

        // Extract flow directory name (e.g., "_flows/demo" -> "demo")
        String flowDirName = flowDir.getFileName().toString();

        try {
            // Delete the _flows/{flowDir} directory (contains flow.yaml and .layout.json)
            if (Files.exists(flowDir)) {
                deleteDirectory(flowDir);
            }

            // Delete the scripts/{flowDir} directory
            Path scriptsDir = repoPath.resolve("scripts").resolve(flowDirName);
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
        Path flowPath = resolveFlowPath(repoPath, path);
        Path flowDir = flowPath.getParent();
        Path flowsRoot = repoPath.resolve("_flows").normalize();
        if (flowDir == null || flowDir.equals(flowsRoot) || !flowDir.startsWith(flowsRoot)) {
            throw new IllegalArgumentException("任务路径不合法");
        }

        Path newFlowDir = resolveFlowPath(repoPath, newPath).getParent();
        if (newFlowDir == null || newFlowDir.equals(flowsRoot) || !newFlowDir.startsWith(flowsRoot)) {
            throw new IllegalArgumentException("任务只能移动到 _flows 目录下");
        }
        OfflineRepoPaths.assertValidSegments(flowsRoot.relativize(newFlowDir));
        if (newFlowDir.equals(flowDir)) {
            return;
        }
        if (newFlowDir.startsWith(flowDir)) {
            throw new IllegalArgumentException("不能移动到任务目录内部");
        }
        if (Files.exists(newFlowDir)) {
            throw new IllegalArgumentException("目标位置已存在同名任务");
        }

        Path scriptsRoot = repoPath.resolve("scripts").normalize();
        String oldSubPath = flowsRoot.relativize(flowDir).toString().replace('\\', '/');
        String newSubPath = flowsRoot.relativize(newFlowDir).toString().replace('\\', '/');
        Path oldScriptsDir = scriptsRoot.resolve(oldSubPath).normalize();
        Path newScriptsDir = scriptsRoot.resolve(newSubPath).normalize();

        try {
            Files.createDirectories(newFlowDir.getParent());
            Files.move(flowDir, newFlowDir);

            if (Files.exists(oldScriptsDir)) {
                Files.createDirectories(newScriptsDir.getParent());
                Files.move(oldScriptsDir, newScriptsDir);
            }

            Path movedFlowPath = newFlowDir.resolve("flow.yaml");
            if (Files.exists(movedFlowPath)) {
                String content = Files.readString(movedFlowPath, StandardCharsets.UTF_8);
                String updatedContent = content.replace(
                        "scripts/" + oldSubPath + "/",
                        "scripts/" + newSubPath + "/"
                );
                if (!content.equals(updatedContent)) {
                    Files.writeString(movedFlowPath, updatedContent, StandardCharsets.UTF_8);
                }
            }

            if (!flowDir.getFileName().equals(newFlowDir.getFileName())) {
                Files.deleteIfExists(kestraFlowFileService.resolveFlowFile(repoPath, path));
            }
            kestraFlowFileService.syncFlowFile(repoPath,
                    repoPath.relativize(movedFlowPath).toString().replace('\\', '/'));
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
