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

    public OfflineFlowContentResponse getFlowContent(Long groupId, String path) {
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        Path flowPath = resolveFlowPath(repoPath, path);
        try {
            return readFlowContent(groupId, path, flowPath);
        } catch (IOException ex) {
            throw new IllegalStateException("读取 Flow 文件失败", ex);
        }
    }

    public OfflineFlowContentResponse saveFlowContent(SaveOfflineFlowRequest request) {
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
            return readFlowContent(request.groupId(), request.path(), flowPath);
        } catch (IOException ex) {
            throw new IllegalStateException("保存 Flow 文件失败", ex);
        }
    }

    private Path resolveFlowPath(Path repoPath, String path) {
        if (path == null || path.isBlank()) {
            throw new IllegalArgumentException("Flow 路径不能为空");
        }

        Path relativePath = Path.of(path).normalize();
        if (relativePath.isAbsolute() || !"flow.yaml".equals(relativePath.getFileName().toString())) {
            throw new IllegalArgumentException("Flow 路径不合法");
        }

        Path resolvedPath = repoPath.resolve(relativePath).normalize();
        if (!resolvedPath.startsWith(repoPath)) {
            throw new IllegalArgumentException("Flow 路径不合法");
        }
        return resolvedPath;
    }

    private OfflineFlowContentResponse readFlowContent(Long groupId, String path, Path flowPath) throws IOException {
        if (!Files.isRegularFile(flowPath)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Flow 文件不存在");
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
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        Path flowPath = resolveFlowPath(repoPath, path);
        Path flowDir = flowPath.getParent();
        if (flowDir == null || !flowDir.startsWith(repoPath)) {
            throw new IllegalArgumentException("Flow 路径不合法");
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
        } catch (IOException ex) {
            throw new IllegalStateException("删除 Flow 失败", ex);
        }
    }

    public void renameFlow(Long groupId, String path, String newName) {
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        Path flowPath = resolveFlowPath(repoPath, path);
        Path flowDir = flowPath.getParent();
        if (flowDir == null || !flowDir.startsWith(repoPath)) {
            throw new IllegalArgumentException("Flow 路径不合法");
        }

        // Extract old flow directory name (e.g., "_flows/demo" -> "demo")
        String oldFlowDirName = flowDir.getFileName().toString();
        Path oldFlowsDir = flowDir;
        Path newFlowsDir = oldFlowsDir.getParent().resolve(newName);

        Path oldScriptsDir = repoPath.resolve("scripts").resolve(oldFlowDirName);
        Path newScriptsDir = repoPath.resolve("scripts").resolve(newName);

        try {
            // Rename _flows/{oldName} to _flows/{newName}
            if (Files.exists(oldFlowsDir)) {
                Files.move(oldFlowsDir, newFlowsDir);
            }

            // Rename scripts/{oldName} to scripts/{newName}
            if (Files.exists(oldScriptsDir)) {
                Files.move(oldScriptsDir, newScriptsDir);
            }

            // Update script paths inside flow.yaml if scripts were renamed
            Path newFlowPath = newFlowsDir.resolve("flow.yaml");
            if (Files.exists(newFlowPath)) {
                String content = Files.readString(newFlowPath, StandardCharsets.UTF_8);
                String updatedContent = content.replaceAll(
                        "(scripts/)" + oldFlowDirName + "(/)",
                        "$1" + newName + "$2"
                );
                if (!content.equals(updatedContent)) {
                    Files.writeString(newFlowPath, updatedContent, StandardCharsets.UTF_8);
                }
            }
        } catch (IOException ex) {
            throw new IllegalStateException("重命名 Flow 失败", ex);
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
