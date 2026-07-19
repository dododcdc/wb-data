package com.wbdata.offline.transfer.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wbdata.offline.transfer.dto.TransferConfig;
import com.wbdata.offline.transfer.dto.TransferEndpointConfig;
import com.wbdata.offline.transfer.dto.TransferFieldMapping;
import com.wbdata.offline.transfer.dto.TransferPartitionMapping;
import com.wbdata.offline.transfer.dto.TransferWriteMode;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collection;
import java.util.List;
import java.util.Set;

@Service
@RequiredArgsConstructor
public class TransferConfigFileService {
    private static final int SCHEMA_VERSION = 1;

    private final ObjectMapper objectMapper;

    public String write(Path repoPath, Long groupId, String flowPath, String taskId, TransferConfig transfer) throws IOException {
        String configPath = buildPath(flowPath, taskId);
        Path file = resolveRepoFile(repoPath, configPath);
        Files.createDirectories(file.getParent());
        Files.writeString(file, serialize(groupId, flowPath, taskId, transfer), StandardCharsets.UTF_8);
        return configPath;
    }

    public String serialize(Long groupId, String flowPath, String taskId, TransferConfig transfer) throws IOException {
        return objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(new StoredTransferConfig(
                SCHEMA_VERSION,
                groupId,
                flowPath,
                taskId,
                transfer.source(),
                transfer.target(),
                transfer.target().writeMode(),
                transfer.fieldMappings(),
                transfer.partitions()
        ));
    }

    public TransferConfig read(Path repoPath, String configPath) throws IOException {
        Path file = resolveRepoFile(repoPath, configPath);
        if (!Files.isRegularFile(file)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "传输配置文件不存在: " + configPath);
        }

        String content = Files.readString(file, StandardCharsets.UTF_8);
        JsonNode root = objectMapper.readTree(content);
        if (!root.has("schemaVersion")) {
            return objectMapper.treeToValue(root, TransferConfig.class);
        }
        StoredTransferConfig stored = objectMapper.treeToValue(root, StoredTransferConfig.class);
        return new TransferConfig(stored.source(), stored.target(), stored.fieldMappings(), stored.partitions());
    }

    public void deleteStaleForFlow(Path repoPath, String flowPath, Collection<String> activeConfigPaths) throws IOException {
        Path flowDirectory = resolveRepoFile(repoPath, "transfers/" + extractFlowDirectoryName(flowPath));
        if (!Files.isDirectory(flowDirectory)) {
            return;
        }

        var active = Set.copyOf(activeConfigPaths);
        try (var files = Files.list(flowDirectory)) {
            for (Path file : files.filter(path -> path.getFileName().toString().endsWith(".transfer.json")).toList()) {
                String relativePath = repoPath.relativize(file).toString().replace('\\', '/');
                if (!active.contains(relativePath)) {
                    Files.deleteIfExists(file);
                }
            }
        }
    }

    public String buildPath(String flowPath, String taskId) {
        if (taskId == null || taskId.isBlank() || taskId.contains("/") || taskId.contains("\\")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "传输任务 ID 不合法");
        }
        return "transfers/" + extractFlowDirectoryName(flowPath) + "/" + taskId + ".transfer.json";
    }

    private String extractFlowDirectoryName(String flowPath) {
        Path normalized = Path.of(flowPath).normalize();
        Path parent = normalized.getParent();
        if (parent == null || parent.getFileName() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Flow 路径不合法");
        }
        return parent.getFileName().toString();
    }

    private Path resolveRepoFile(Path repoPath, String path) {
        Path relativePath = Path.of(path).normalize();
        if (relativePath.isAbsolute()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "传输配置文件路径不合法");
        }
        Path resolvedPath = repoPath.resolve(relativePath).normalize();
        if (!resolvedPath.startsWith(repoPath)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "传输配置文件路径不合法");
        }
        return resolvedPath;
    }

    private record StoredTransferConfig(
            int schemaVersion,
            Long groupId,
            String flowPath,
            String taskId,
            TransferEndpointConfig source,
            TransferEndpointConfig target,
            TransferWriteMode writeMode,
            List<TransferFieldMapping> fieldMappings,
            List<TransferPartitionMapping> partitions
    ) {
    }
}
