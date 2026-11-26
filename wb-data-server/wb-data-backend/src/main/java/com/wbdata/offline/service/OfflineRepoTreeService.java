package com.wbdata.offline.service;

import com.wbdata.offline.repo.service.RepoLockManager;

import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.entity.WbOfflineFlowIndex;
import com.wbdata.offline.repo.dto.CreateFolderRequest;
import com.wbdata.offline.repo.dto.OfflineRepoTreeNodeResponse;
import com.wbdata.offline.repo.dto.OfflineRepoTreeResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.lang.Nullable;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
public class OfflineRepoTreeService {

    private final OfflineProperties offlineProperties;
    private final RepoLockManager repoLockManager;
    private final OfflineKestraFlowFileService kestraFlowFileService;
    private final OfflineRecentFlowService recentFlowService;
    @Nullable
    private final OfflineFlowIndexService offlineFlowIndexService;
    private final OfflineFlowYamlSupport yamlSupport = new OfflineFlowYamlSupport();

    public OfflineRepoTreeService(OfflineProperties offlineProperties,
                                  RepoLockManager repoLockManager,
                                  OfflineKestraFlowFileService kestraFlowFileService) {
        this(offlineProperties, repoLockManager, kestraFlowFileService, new OfflineRecentFlowService(null), null);
    }

    public OfflineRepoTreeService(OfflineProperties offlineProperties,
                                  RepoLockManager repoLockManager,
                                  OfflineKestraFlowFileService kestraFlowFileService,
                                  OfflineRecentFlowService recentFlowService) {
        this(offlineProperties, repoLockManager, kestraFlowFileService, recentFlowService, null);
    }

    @Autowired
    public OfflineRepoTreeService(OfflineProperties offlineProperties,
                                  RepoLockManager repoLockManager,
                                  OfflineKestraFlowFileService kestraFlowFileService,
                                  OfflineRecentFlowService recentFlowService,
                                  @Nullable OfflineFlowIndexService offlineFlowIndexService) {
        this.offlineProperties = offlineProperties;
        this.repoLockManager = repoLockManager;
        this.kestraFlowFileService = kestraFlowFileService;
        this.recentFlowService = recentFlowService;
        this.offlineFlowIndexService = offlineFlowIndexService;
    }

    public OfflineRepoTreeResponse getRepoTree(Long groupId, String rootName) {
        return getRepoTree(groupId, rootName, null);
    }

    public OfflineRepoTreeResponse getRepoTree(Long groupId, String rootName, Long userId) {
        return repoLockManager.withLock(groupId, () -> getRepoTreeUnlocked(groupId, rootName, userId));
    }

    private OfflineRepoTreeResponse getRepoTreeUnlocked(Long groupId, String rootName, Long userId) {
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        Map<String, WbOfflineFlowIndex> indexByPath =
                (offlineFlowIndexService != null && offlineFlowIndexService.isEnabled())
                        ? offlineFlowIndexService.listGroupFlowMap(groupId)
                        : null;
        OfflineRepoTreeNodeResponse root = OfflineRepoTreeNodeResponse.directory(
                "group-" + groupId,
                "ROOT",
                rootName,
                "",
                Files.isDirectory(repoPath) ? buildRootChildren(groupId, repoPath, indexByPath) : List.of()
        );
        Set<String> existingFlowPaths = new HashSet<>();
        collectFlowPaths(root, existingFlowPaths);
        List<String> recentFlowPaths = recentFlowService.listRecentFlowPaths(userId, groupId).stream()
                .filter(existingFlowPaths::contains)
                .toList();
        return new OfflineRepoTreeResponse(groupId, root, recentFlowPaths);
    }

    private void collectFlowPaths(OfflineRepoTreeNodeResponse node, Set<String> flowPaths) {
        if ("FLOW".equals(node.kind()) && node.path() != null) {
            flowPaths.add(node.path());
        }
        if (node.children() != null) {
            for (OfflineRepoTreeNodeResponse child : node.children()) {
                collectFlowPaths(child, flowPaths);
            }
        }
    }

    private List<OfflineRepoTreeNodeResponse> buildRootChildren(Long groupId,
                                                                Path repoPath,
                                                                @Nullable Map<String, WbOfflineFlowIndex> indexByPath) {
        Path flowsDirectory = repoPath.resolve("_flows");
        if (!Files.isDirectory(flowsDirectory)) {
            return List.of();
        }
        return buildChildren(groupId, repoPath, flowsDirectory, true, indexByPath);
    }

    private List<OfflineRepoTreeNodeResponse> buildChildren(Long groupId,
                                                            Path repoRoot,
                                                            Path directory,
                                                            boolean insideFlows,
                                                            @Nullable Map<String, WbOfflineFlowIndex> indexByPath) {
        try (var stream = Files.list(directory)) {
            List<OfflineRepoTreeNodeResponse> nodes = new ArrayList<>();
            for (Path child : stream.toList()) {
                OfflineRepoTreeNodeResponse node = buildNode(groupId, repoRoot, child, insideFlows, indexByPath);
                if (node != null) {
                    nodes.add(node);
                }
            }
            return sortNodes(nodes);
        } catch (IOException ex) {
            throw new IllegalStateException("读取离线仓库目录树失败", ex);
        }
    }

    private OfflineRepoTreeNodeResponse buildNode(Long groupId,
                                                  Path repoRoot,
                                                  Path path,
                                                  boolean insideFlows,
                                                  @Nullable Map<String, WbOfflineFlowIndex> indexByPath) {
        String fileName = path.getFileName().toString();
        if (isHidden(fileName)) {
            return null;
        }

        String relativePath = toRelativePath(repoRoot, path);
        if (Files.isDirectory(path)) {
            if (insideFlows && isLeafFlowDirectory(path)) {
                Path flowPath = path.resolve("flow.yaml");
                String flowRelativePath = toRelativePath(repoRoot, flowPath);
                return flowNode(groupId, flowRelativePath, path.getFileName().toString(), flowPath, indexByPath);
            }
            return OfflineRepoTreeNodeResponse.directory(
                    relativePath,
                    "DIRECTORY",
                    fileName,
                    relativePath,
                    buildChildren(groupId, repoRoot, path, insideFlows, indexByPath)
            );
        }
        if (insideFlows) {
            if (!"flow.yaml".equals(fileName)) {
                return null;
            }
            return flowNode(groupId, relativePath, resolveFlowDisplayName(path), path, indexByPath);
        }
        return null;
    }

    private OfflineRepoTreeNodeResponse flowNode(Long groupId,
                                                 String path,
                                                 String name,
                                                 Path flowFile,
                                                 @Nullable Map<String, WbOfflineFlowIndex> indexByPath) {
        if (indexByPath != null) {
            String normalizedPath = OfflineFlowIndexService.normalizeFlowPath(path);
            WbOfflineFlowIndex indexed = indexByPath.get(normalizedPath);
            if (indexed != null) {
                if (!OfflineFlowIndexService.PARSE_STATUS_OK.equals(indexed.getParseStatus())) {
                    return new OfflineRepoTreeNodeResponse(path, "FLOW", name, path, List.of(), "NONE", null, 0);
                }
                String scheduleState = !Boolean.TRUE.equals(indexed.getHasSchedule())
                        ? "NONE"
                        : Boolean.TRUE.equals(indexed.getScheduleEnabled()) ? "ENABLED" : "DISABLED";
                int dependencyCount = indexed.getDependencyCount() == null ? 0 : indexed.getDependencyCount();
                return new OfflineRepoTreeNodeResponse(path, "FLOW", name, path, List.of(),
                        scheduleState, indexed.getSchedulePeriod(), dependencyCount);
            }
        }
        try {
            String content = Files.readString(flowFile, StandardCharsets.UTF_8);
            if (indexByPath != null && offlineFlowIndexService != null) {
                offlineFlowIndexService.onFlowSaved(groupId, path, content, flowFile);
            }
            OfflineFlowYamlSupport.FlowIndexMetadata meta = yamlSupport.parseIndexMetadata(content);
            var schedule = meta.schedule();
            String scheduleState = schedule == null ? "NONE" : schedule.enabled() ? "ENABLED" : "DISABLED";
            String schedulePeriod = schedule == null || schedule.period() == null ? null : schedule.period().name();
            return new OfflineRepoTreeNodeResponse(path, "FLOW", name, path, List.of(),
                    scheduleState, schedulePeriod, meta.dependencies().size());
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
        OfflineRecentFlowService.assertNotReservedRootPath(repoPath, folderPath);
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
        if (offlineFlowIndexService != null) {
            offlineFlowIndexService.onFolderDeleted(groupId, path);
        }
        recentFlowService.onFolderDeleted(groupId, path);
    }

    public void moveFolder(Long groupId, String path, String newPath) {
        repoLockManager.withLock(groupId, () -> moveFolderUnlocked(groupId, path, newPath));
    }

    private void moveFolderUnlocked(Long groupId, String path, String newPath) {
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        Path oldPath = OfflineRepoPaths.resolveDirectory(repoPath, path);
        Path targetPath = OfflineRepoPaths.resolveDirectory(repoPath, newPath);
        try {
            OfflineRepoPaths.moveDirectory(repoPath, oldPath, targetPath, false, kestraFlowFileService);
        } catch (IOException ex) {
            throw new IllegalStateException("移动文件夹失败", ex);
        }
        if (offlineFlowIndexService != null) {
            offlineFlowIndexService.onFolderMoved(groupId, path, newPath, repoPath);
        }
        recentFlowService.onFolderMoved(groupId, path, newPath);
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

    private void deleteDirectory(Path dir) throws IOException {
        try (var stream = Files.walk(dir)) {
            var files = stream.sorted(Comparator.reverseOrder()).toList();
            for (Path file : files) {
                Files.delete(file);
            }
        }
    }
}
