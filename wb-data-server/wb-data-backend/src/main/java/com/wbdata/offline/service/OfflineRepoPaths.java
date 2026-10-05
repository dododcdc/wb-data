package com.wbdata.offline.service;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static java.nio.file.LinkOption.NOFOLLOW_LINKS;

final class OfflineRepoPaths {

    private static final ObjectMapper TRANSFER_JSON = new ObjectMapper()
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);

    private OfflineRepoPaths() {
    }

    static void assertValidSegments(Path relativePath) {
        for (Path segment : relativePath) {
            String name = segment.toString();
            if (name.isBlank() || ".".equals(name) || "..".equals(name)
                    || name.contains("/") || name.contains("\\")) {
                throw new IllegalArgumentException("路径包含非法目录名: " + name);
            }
        }
    }

    static Path resolveFlowDirectory(Path repoPath, String path) {
        Path flowFile = resolveRelativePath(repoPath, path);
        if (!"flow.yaml".equals(flowFile.getFileName().toString())) {
            throw new IllegalArgumentException("任务路径不合法");
        }
        return resolveDirectory(repoPath, relative(repoPath, flowFile.getParent()));
    }

    static Path resolveDirectory(Path repoPath, String path) {
        Path directory = resolveRelativePath(repoPath, path);
        Path flowsRoot = repoPath.resolve("_flows");
        if (directory.equals(flowsRoot) || !directory.startsWith(flowsRoot)) {
            throw new IllegalArgumentException("只能移动 _flows 目录下的任务或文件夹");
        }
        return directory;
    }

    private static Path resolveRelativePath(Path repoPath, String path) {
        if (path == null || path.isBlank()) {
            throw new IllegalArgumentException("路径不能为空");
        }
        Path relativePath = Path.of(path);
        // Validate before normalization so an embedded '..' cannot disappear.
        if (relativePath.isAbsolute()) {
            throw new IllegalArgumentException("路径不能为绝对路径");
        }
        assertValidSegments(relativePath);
        Path resolved = repoPath.resolve(relativePath).normalize();
        assertNoSymlinks(repoPath, resolved);
        return resolved;
    }

    static void assertNoSymlinks(Path repoPath, Path path) {
        if (!path.startsWith(repoPath)) {
            throw new IllegalArgumentException("非法路径");
        }
        Path current = repoPath;
        assertPathComponent(current, current.equals(path));
        for (Path segment : repoPath.relativize(path)) {
            current = current.resolve(segment);
            assertPathComponent(current, current.equals(path));
        }
    }

    private static void assertPathComponent(Path path, boolean leaf) {
        if (Files.isSymbolicLink(path)) {
            throw new IllegalArgumentException("路径不能包含符号链接: " + path);
        }
        if (!leaf && Files.exists(path, NOFOLLOW_LINKS) && !Files.isDirectory(path, NOFOLLOW_LINKS)) {
            throw new IllegalArgumentException("父路径不是目录: " + path);
        }
    }

    private static List<Path> inspectTree(Path root) throws IOException {
        try (var stream = Files.walk(root)) {
            List<Path> paths = stream.sorted().toList();
            for (Path path : paths) {
                if (Files.isSymbolicLink(path)) {
                    throw new IllegalArgumentException("目录不能包含符号链接: " + path);
                }
            }
            return paths;
        }
    }

    private static void assertNoFlowParent(Path flowsRoot, Path directory) {
        for (Path parent = directory.getParent(); parent.startsWith(flowsRoot); parent = parent.getParent()) {
            if (Files.exists(parent.resolve("flow.yaml"), NOFOLLOW_LINKS)) {
                throw new IllegalArgumentException("父目录不能是任务目录");
            }
        }
    }

    static void moveDirectory(Path repoPath, Path source, Path target, boolean flow,
                              OfflineKestraFlowFileService mirrors) throws IOException {
        if (!Files.isDirectory(source, NOFOLLOW_LINKS)) {
            throw new IllegalArgumentException("源目录不存在或不是目录");
        }
        if (flow ? !Files.isRegularFile(source.resolve("flow.yaml"), NOFOLLOW_LINKS)
                : Files.exists(source.resolve("flow.yaml"), NOFOLLOW_LINKS)) {
            throw new IllegalArgumentException(flow ? "源任务文件不存在或类型不合法" : "文件夹接口不能移动任务");
        }
        Path flowsRoot = repoPath.resolve("_flows");
        assertNoFlowParent(flowsRoot, source);
        assertNoFlowParent(flowsRoot, target);
        List<Path> sourceFiles = inspectTree(source);
        String oldSubPath = relative(flowsRoot, source);
        String newSubPath = relative(flowsRoot, target);
        Path oldScripts = repoPath.resolve("scripts").resolve(oldSubPath);
        Path newScripts = repoPath.resolve("scripts").resolve(newSubPath);
        assertNoSymlinks(repoPath, oldScripts);
        assertNoSymlinks(repoPath, newScripts);
        boolean hasScripts = Files.exists(oldScripts, NOFOLLOW_LINKS);
        if (hasScripts) {
            if (!Files.isDirectory(oldScripts, NOFOLLOW_LINKS)) {
                throw new IllegalArgumentException("源 scripts 路径不是目录");
            }
            inspectTree(oldScripts);
        }
        if (source.equals(target)) {
            return;
        }
        if (target.startsWith(source)) {
            throw new IllegalArgumentException("不能移动到自身子目录");
        }
        if (Files.exists(target, NOFOLLOW_LINKS) || Files.exists(newScripts, NOFOLLOW_LINKS)) {
            throw new IllegalArgumentException("目标目录或 scripts 路径已存在");
        }

        Map<Path, FileSnapshot> contents = new LinkedHashMap<>();
        Map<Path, FileSnapshot> mirrorContents = new LinkedHashMap<>();
        Map<Path, TransferMove> transferMoves = new LinkedHashMap<>();
        List<Path> repoFlows;
        try (var paths = Files.walk(flowsRoot)) {
            repoFlows = paths.filter(p -> "flow.yaml".equals(p.getFileName().toString()))
                    .filter(p -> Files.isRegularFile(p, NOFOLLOW_LINKS)).toList();
        }
        // Snapshot every file before the first mutation, including mirrors that sync may overwrite.
        for (Path file : sourceFiles) {
            if (!"flow.yaml".equals(file.getFileName().toString())) {
                continue;
            }
            Path movedFile = target.resolve(source.relativize(file));
            Path oldMirror = mirrors.resolveFlowFile(repoPath, relative(repoPath, file));
            Path newMirror = mirrors.resolveFlowFile(repoPath, relative(repoPath, movedFile));
            assertNoSymlinks(repoPath, oldMirror);
            assertNoSymlinks(repoPath, newMirror);
            for (Path other : repoFlows) {
                Path otherMirror = mirrors.resolveFlowFile(repoPath, relative(repoPath, other));
                if (!other.equals(file) && (otherMirror.equals(oldMirror) || otherMirror.equals(newMirror))) {
                    throw new IllegalArgumentException("Kestra mirror 与其他任务冲突");
                }
            }
            if (!oldMirror.equals(newMirror) && Files.exists(newMirror, NOFOLLOW_LINKS)) {
                throw new IllegalArgumentException("目标 Kestra mirror 已存在");
            }
            contents.put(file, FileSnapshot.read(file));
            mirrorContents.put(oldMirror, FileSnapshot.read(oldMirror));
            mirrorContents.put(newMirror, FileSnapshot.read(newMirror));
            transferMoves.put(file, prepareTransferMove(repoPath, file, movedFile));
        }

        List<Undo> undo = new ArrayList<>();
        try {
            createDirectories(target.getParent(), undo);
            Files.move(source, target);
            undo.add(() -> Files.move(target, source));
            if (hasScripts) {
                createDirectories(newScripts.getParent(), undo);
                Files.move(oldScripts, newScripts);
                undo.add(() -> Files.move(newScripts, oldScripts));
            }
            for (var entry : contents.entrySet()) {
                Path file = entry.getKey();
                Path movedFile = target.resolve(source.relativize(file));
                TransferMove transfer = transferMoves.get(file);
                if (transfer.exists() && !transfer.source().equals(transfer.target())) {
                    Files.move(transfer.source(), transfer.target());
                    undo.add(() -> Files.move(transfer.target(), transfer.source()));
                }
                for (TransferUpdate update : transfer.updates()) {
                    Path movedConfig = transfer.target().resolve(update.relativePath());
                    undo.add(() -> update.original().restore(movedConfig));
                    Files.write(movedConfig, update.bytes());
                }
                FileSnapshot original = entry.getValue();
                String content = new String(original.bytes(), StandardCharsets.UTF_8);
                String updated = content.replace("scripts/" + oldSubPath + "/", "scripts/" + newSubPath + "/")
                        .replace(relative(repoPath, transfer.source()) + "/", relative(repoPath, transfer.target()) + "/");
                if (!content.equals(updated)) {
                    undo.add(() -> original.restore(movedFile));
                    Files.writeString(movedFile, updated, StandardCharsets.UTF_8);
                }
                Path oldMirror = mirrors.resolveFlowFile(repoPath, relative(repoPath, file));
                Path newMirror = mirrors.resolveFlowFile(repoPath, relative(repoPath, movedFile));
                createDirectories(newMirror.getParent(), undo);
                undo.add(() -> mirrorContents.get(newMirror).restore(newMirror));
                mirrors.syncFlowFile(repoPath, relative(repoPath, movedFile));
                if (!oldMirror.equals(newMirror)) {
                    undo.add(() -> mirrorContents.get(oldMirror).restore(oldMirror));
                    Files.deleteIfExists(oldMirror);
                }
            }
        } catch (IOException | RuntimeException ex) {
            // Best-effort rollback: keep trying subsequent undo steps even if one fails.
            for (int i = undo.size() - 1; i >= 0; i--) {
                try {
                    undo.get(i).run();
                } catch (IOException | RuntimeException rollbackFailure) {
                    ex.addSuppressed(rollbackFailure);
                }
            }
            throw ex;
        }
    }

    private static TransferMove prepareTransferMove(Path repoPath, Path flowFile, Path movedFlowFile) throws IOException {
        Path source = repoPath.resolve("transfers").resolve(flowFile.getParent().getFileName());
        Path target = repoPath.resolve("transfers").resolve(movedFlowFile.getParent().getFileName());
        List<Path> files = inspectTransferDirectory(repoPath, source);
        if (!source.equals(target)) {
            inspectTransferDirectory(repoPath, target);
            // A stale target must not be reused, even when this flow has no transfer directory yet.
            if (Files.exists(target, NOFOLLOW_LINKS)) {
                throw new IllegalArgumentException("目标 transfers 目录已存在");
            }
        }
        List<TransferUpdate> updates = new ArrayList<>();
        for (Path file : files) {
            if (file.equals(source) || !file.getFileName().toString().endsWith(".transfer.json")) {
                continue;
            }
            FileSnapshot original = FileSnapshot.read(file);
            JsonNode root = TRANSFER_JSON.readTree(original.bytes());
            if (!(root instanceof ObjectNode object) || !object.path("flowPath").isTextual()
                    || !relative(repoPath, flowFile).equals(object.path("flowPath").textValue())) {
                throw new IllegalArgumentException("传输配置类型或 flowPath 归属不合法: " + file);
            }
            object.put("flowPath", relative(repoPath, movedFlowFile));
            updates.add(new TransferUpdate(source.relativize(file), original,
                    TRANSFER_JSON.writerWithDefaultPrettyPrinter().writeValueAsBytes(object)));
        }
        return new TransferMove(source, target, Files.exists(source, NOFOLLOW_LINKS), updates);
    }

    private static List<Path> inspectTransferDirectory(Path repoPath, Path directory) throws IOException {
        assertNoSymlinks(repoPath, directory);
        if (!Files.exists(directory, NOFOLLOW_LINKS)) {
            return List.of();
        }
        if (!Files.isDirectory(directory, NOFOLLOW_LINKS)) {
            throw new IllegalArgumentException("transfers 路径不是目录: " + directory);
        }
        return inspectTree(directory);
    }

    private record TransferMove(Path source, Path target, boolean exists, List<TransferUpdate> updates) {
    }

    private record TransferUpdate(Path relativePath, FileSnapshot original, byte[] bytes) {
    }

    private static void createDirectories(Path directory, List<Undo> undo) throws IOException {
        if (!Files.exists(directory, NOFOLLOW_LINKS)) {
            createDirectories(directory.getParent(), undo);
            Files.createDirectory(directory);
            undo.add(() -> Files.delete(directory));
        }
    }

    private static String relative(Path root, Path path) {
        return root.relativize(path).toString().replace('\\', '/');
    }

    @FunctionalInterface
    private interface Undo {
        void run() throws IOException;
    }

    private record FileSnapshot(byte[] bytes, FileTime modifiedAt) {
        static FileSnapshot read(Path path) throws IOException {
            if (!Files.exists(path, NOFOLLOW_LINKS)) {
                return new FileSnapshot(null, null);
            }
            if (!Files.isRegularFile(path, NOFOLLOW_LINKS)) {
                throw new IllegalArgumentException("路径不是普通文件: " + path);
            }
            return new FileSnapshot(Files.readAllBytes(path), Files.getLastModifiedTime(path));
        }

        void restore(Path path) throws IOException {
            if (bytes == null) {
                Files.deleteIfExists(path);
            } else {
                Files.write(path, bytes);
                Files.setLastModifiedTime(path, modifiedAt);
            }
        }
    }
}
