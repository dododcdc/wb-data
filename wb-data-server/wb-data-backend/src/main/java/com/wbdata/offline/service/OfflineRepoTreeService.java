package com.wbdata.offline.service;

import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.dto.CreateFolderRequest;
import com.wbdata.offline.dto.OfflineRepoTreeNodeResponse;
import com.wbdata.offline.dto.OfflineRepoTreeResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

@Service
@RequiredArgsConstructor
public class OfflineRepoTreeService {

    private final OfflineProperties offlineProperties;
    private final RepoLockManager repoLockManager;
    private final OfflineFlowYamlSupport yamlSupport = new OfflineFlowYamlSupport();

    public OfflineRepoTreeResponse getRepoTree(Long groupId, String rootName) {
        return repoLockManager.withLock(groupId, () -> getRepoTreeUnlocked(groupId, rootName));
    }

    private OfflineRepoTreeResponse getRepoTreeUnlocked(Long groupId, String rootName) {
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        return new OfflineRepoTreeResponse(
                groupId,
                OfflineRepoTreeNodeResponse.directory(
                        "group-" + groupId,
                        "ROOT",
                        rootName,
                        "",
                        Files.isDirectory(repoPath) ? buildRootChildren(repoPath) : List.of()
                )
        );
    }

    private List<OfflineRepoTreeNodeResponse> buildRootChildren(Path repoPath) {
        Path flowsDirectory = repoPath.resolve("_flows");
        if (!Files.isDirectory(flowsDirectory)) {
            return List.of();
        }
        return buildChildren(repoPath, flowsDirectory, true);
    }

    private List<OfflineRepoTreeNodeResponse> buildChildren(Path repoRoot, Path directory, boolean insideFlows) {
        try (var stream = Files.list(directory)) {
            List<OfflineRepoTreeNodeResponse> nodes = new ArrayList<>();
            for (Path child : stream.toList()) {
                OfflineRepoTreeNodeResponse node = buildNode(repoRoot, child, insideFlows);
                if (node != null) {
                    nodes.add(node);
                }
            }
            return sortNodes(nodes);
        } catch (IOException ex) {
            throw new IllegalStateException("读取离线仓库目录树失败", ex);
        }
    }

    private OfflineRepoTreeNodeResponse buildNode(Path repoRoot, Path path, boolean insideFlows) {
        String fileName = path.getFileName().toString();
        if (isHidden(fileName)) {
            return null;
        }

        String relativePath = toRelativePath(repoRoot, path);
        if (Files.isDirectory(path)) {
            if (insideFlows && isLeafFlowDirectory(path)) {
                Path flowPath = path.resolve("flow.yaml");
                String flowRelativePath = toRelativePath(repoRoot, flowPath);
                return flowNode(flowRelativePath, path.getFileName().toString(), flowPath);
            }
            return OfflineRepoTreeNodeResponse.directory(
                    relativePath,
                    "DIRECTORY",
                    fileName,
                    relativePath,
                    buildChildren(repoRoot, path, insideFlows)
            );
        }
        if (insideFlows) {
            if (!"flow.yaml".equals(fileName)) {
                return null;
            }
            return flowNode(relativePath, resolveFlowDisplayName(path), path);
        }
        return null;
    }

    private OfflineRepoTreeNodeResponse flowNode(String path, String name, Path flowFile) {
        try {
            String content = Files.readString(flowFile, StandardCharsets.UTF_8);
            var schedule = yamlSupport.readSchedule(content);
            int dependencyCount = yamlSupport.readDependencies(content).size();
            String scheduleState = schedule == null ? "NONE" : schedule.enabled() ? "ENABLED" : "DISABLED";
            String schedulePeriod = schedule == null || schedule.period() == null ? null : schedule.period().name();
            return new OfflineRepoTreeNodeResponse(path, "FLOW", name, path, List.of(),
                    scheduleState, schedulePeriod, dependencyCount);
        } catch (RuntimeException | IOException ex) {
            return new OfflineRepoTreeNodeResponse(path, "FLOW", name, path, List.of(), "NONE", null, 0);
        }
    }

    private boolean isLeafFlowDirectory(Path directory) {
        Path flowPath = directory.resolve("flow.yaml");
        if (!Files.isRegularFile(flowPath)) {
            return false;
        }
        try (var stream = Files.list(directory)) {
            return stream
                    .map(path -> path.getFileName().toString())
                    .filter(name -> !isHidden(name))
                    .allMatch("flow.yaml"::equals);
        } catch (IOException ex) {
            throw new IllegalStateException("读取离线仓库目录树失败", ex);
        }
    }

    private List<OfflineRepoTreeNodeResponse> sortNodes(List<OfflineRepoTreeNodeResponse> nodes) {
        return nodes.stream()
                .sorted(Comparator
                        .comparingInt(this::kindOrder)
                        .thenComparing(OfflineRepoTreeNodeResponse::name, String.CASE_INSENSITIVE_ORDER))
                .toList();
    }

    private int kindOrder(OfflineRepoTreeNodeResponse node) {
        return switch (node.kind()) {
            case "DIRECTORY" -> 0;
            case "FLOW" -> 1;
            default -> 2;
        };
    }

    private String toRelativePath(Path repoRoot, Path path) {
        return repoRoot.relativize(path).toString().replace('\\', '/');
    }

    private boolean isHidden(String name) {
        return name.startsWith(".");
    }

    private String resolveFlowDisplayName(Path flowFile) {
        Path parent = flowFile.getParent();
        if (parent == null || parent.getFileName() == null) {
            return stripExtension(flowFile.getFileName().toString());
        }
        String parentName = parent.getFileName().toString();
        if (parentName.isBlank() || "_flows".equals(parentName)) {
            return stripExtension(flowFile.getFileName().toString());
        }
        return parentName;
    }

    private String stripExtension(String fileName) {
        int dotIndex = fileName.lastIndexOf('.');
        return dotIndex > 0 ? fileName.substring(0, dotIndex) : fileName;
    }

    public void createFolder(CreateFolderRequest request) {
        repoLockManager.withLock(request.groupId(), () -> createFolderUnlocked(request));
    }

    private void createFolderUnlocked(CreateFolderRequest request) {
        Path repoPath = offlineProperties.resolveRepoPath(request.groupId());
        Path folderPath = repoPath.resolve(request.path()).normalize();
        if (!folderPath.startsWith(repoPath)) {
            throw new IllegalArgumentException("文件夹路径不合法");
        }
        try {
            Files.createDirectories(folderPath);
            // Create .gitkeep inside the new folder so Git tracks it
            Path gitkeep = folderPath.resolve(".gitkeep");
            if (!Files.exists(gitkeep)) {
                Files.writeString(gitkeep, "");
            }
        } catch (IOException ex) {
            throw new IllegalStateException("创建文件夹失败", ex);
        }
    }

    public void deleteFolder(Long groupId, String path) {
        repoLockManager.withLock(groupId, () -> deleteFolderUnlocked(groupId, path));
    }

    private void deleteFolderUnlocked(Long groupId, String path) {
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        Path targetPath = resolveSafePath(repoPath, path);

        if (targetPath.equals(repoPath)) {
            throw new IllegalArgumentException("不能删除根目录");
        }

        try {
            // Delete in _flows
            if (Files.exists(targetPath)) {
                deleteDirectory(targetPath);
            }

            // Delete in scripts/
            if (path != null && path.startsWith("_flows")) {
                String relativeSubPath = path.substring("_flows".length());
                if (relativeSubPath.startsWith("/")) relativeSubPath = relativeSubPath.substring(1);

                if (!relativeSubPath.isEmpty()) {
                    Path scriptsPath = repoPath.resolve("scripts").resolve(relativeSubPath).normalize();
                    if (Files.exists(scriptsPath) && scriptsPath.startsWith(repoPath.resolve("scripts"))) {
                        deleteDirectory(scriptsPath);
                    }
                }
            }
        } catch (IOException ex) {
            throw new IllegalStateException("删除文件夹失败", ex);
        }
    }

    public void moveFolder(Long groupId, String path, String newPath) {
        repoLockManager.withLock(groupId, () -> moveFolderUnlocked(groupId, path, newPath));
    }

    private void moveFolderUnlocked(Long groupId, String path, String newPath) {
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        Path flowsRoot = repoPath.resolve("_flows").normalize();
        Path oldPath = resolveSafePath(repoPath, path);
        if (oldPath.equals(flowsRoot) || !oldPath.startsWith(flowsRoot)) {
            throw new IllegalArgumentException("只能移动 _flows 目录下的文件夹");
        }

        Path targetPath = resolveSafePath(repoPath, newPath);
        if (targetPath.equals(flowsRoot) || !targetPath.startsWith(flowsRoot)) {
            throw new IllegalArgumentException("文件夹只能移动到 _flows 目录下");
        }
        OfflineRepoPaths.assertValidSegments(flowsRoot.relativize(targetPath));
        if (targetPath.equals(oldPath)) {
            return;
        }
        if (targetPath.startsWith(oldPath)) {
            throw new IllegalArgumentException("不能移动到自身子目录");
        }
        if (Files.exists(targetPath)) {
            throw new IllegalArgumentException("目标位置已存在同名文件夹");
        }

        String oldSubPath = flowsRoot.relativize(oldPath).toString().replace('\\', '/');
        String newSubPath = flowsRoot.relativize(targetPath).toString().replace('\\', '/');
        Path scriptsRoot = repoPath.resolve("scripts").normalize();
        Path oldScriptsPath = scriptsRoot.resolve(oldSubPath).normalize();
        Path newScriptsPath = scriptsRoot.resolve(newSubPath).normalize();

        try {
            Files.createDirectories(targetPath.getParent());
            if (Files.exists(oldPath)) {
                Files.move(oldPath, targetPath);
            }

            if (Files.exists(oldScriptsPath)) {
                Files.createDirectories(newScriptsPath.getParent());
                Files.move(oldScriptsPath, newScriptsPath);
            }

            updateFlowReferences(targetPath, oldSubPath, newSubPath);
        } catch (IOException ex) {
            throw new IllegalStateException("移动文件夹失败", ex);
        }
    }

    private Path resolveSafePath(Path repoPath, String path) {
        if (path == null || path.isBlank()) {
            return repoPath;
        }
        Path resolved = repoPath.resolve(path).normalize();
        if (!resolved.startsWith(repoPath)) {
            throw new IllegalArgumentException("非法路径");
        }
        return resolved;
    }

    private void updateFlowReferences(Path root, String oldRelativePath, String newRelativePath) throws IOException {
        String oldPrefix = "scripts/" + oldRelativePath + "/";
        String newPrefix = "scripts/" + newRelativePath + "/";

        try (var stream = Files.walk(root)) {
            List<Path> flowFiles = stream
                    .filter(p -> "flow.yaml".equals(p.getFileName().toString()))
                    .toList();

            for (Path flowFile : flowFiles) {
                String content = Files.readString(flowFile, StandardCharsets.UTF_8);
                String updatedContent = content.replace(oldPrefix, newPrefix);
                if (!content.equals(updatedContent)) {
                    Files.writeString(flowFile, updatedContent, StandardCharsets.UTF_8);
                }
            }
        }
    }

    private void deleteDirectory(Path dir) throws IOException {
        try (var stream = Files.walk(dir)) {
            var files = stream.sorted(Comparator.reverseOrder()).toList();
            for (Path file : files) {
                Files.delete(file);
            }
        }
    }
}
