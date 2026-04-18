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

    public OfflineRepoTreeResponse getRepoTree(Long groupId, String rootName) {
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        return new OfflineRepoTreeResponse(
                groupId,
                new OfflineRepoTreeNodeResponse(
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
                return new OfflineRepoTreeNodeResponse(
                        flowRelativePath,
                        "FLOW",
                        path.getFileName().toString(),
                        flowRelativePath,
                        List.of()
                );
            }
            return new OfflineRepoTreeNodeResponse(
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
            return new OfflineRepoTreeNodeResponse(
                    relativePath,
                    "FLOW",
                    resolveFlowDisplayName(path),
                    relativePath,
                    List.of()
            );
        }
        return null;
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

    public void renameFolder(Long groupId, String path, String newName) {
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        Path oldPath = resolveSafePath(repoPath, path);

        if (oldPath.equals(repoPath)) {
            throw new IllegalArgumentException("不能重命名根目录");
        }

        Path newPath = oldPath.getParent().resolve(newName).normalize();
        if (!newPath.startsWith(repoPath)) {
            throw new IllegalArgumentException("非法新名称");
        }

        try {
            // Rename in _flows
            if (Files.exists(oldPath)) {
                Files.move(oldPath, newPath);
            }

            // Rename in scripts/
            if (path != null && path.startsWith("_flows")) {
                String relativeSubPath = path.substring("_flows".length());
                if (relativeSubPath.startsWith("/")) relativeSubPath = relativeSubPath.substring(1);

                if (!relativeSubPath.isEmpty()) {
                    Path oldScriptsPath = repoPath.resolve("scripts").resolve(relativeSubPath).normalize();
                    Path newScriptsPath = oldScriptsPath.getParent().resolve(newName).normalize();

                    if (Files.exists(oldScriptsPath) && oldScriptsPath.startsWith(repoPath.resolve("scripts"))) {
                        Files.move(oldScriptsPath, newScriptsPath);
                    }

                    // Update flow.yaml references
                    String parentRelativePath = Path.of(relativeSubPath).getParent() == null ? "" : Path.of(relativeSubPath).getParent().toString().replace('\\', '/');
                    String newRelativePath = parentRelativePath.isEmpty() ? newName : parentRelativePath + "/" + newName;
                    updateFlowReferences(newPath, relativeSubPath, newRelativePath);
                }
            }
        } catch (IOException ex) {
            throw new IllegalStateException("重命名文件夹失败", ex);
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
