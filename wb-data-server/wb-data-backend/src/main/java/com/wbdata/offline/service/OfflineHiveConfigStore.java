package com.wbdata.offline.service;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wbdata.offline.repo.service.SnapshotFileAccess;
import com.wbdata.offline.repo.service.WorkingTreeSnapshotFileAccess;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * Persists structured per-node Hive runtime parameters (`hiveConf`) in `_flows/<flowDir>/.hive-conf.json`.
 */
@Component
public class OfflineHiveConfigStore {

    public static final String FILE_NAME = ".hive-conf.json";
    private static final int SCHEMA_VERSION = 1;
    private static final int MAX_KEY_LENGTH = 200;
    private static final Pattern KEY_PATTERN = Pattern.compile("^[a-zA-Z0-9._-]+$");

    private final ObjectMapper objectMapper;

    public OfflineHiveConfigStore(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record HiveConfigFile(
            int schemaVersion,
            Map<String, Map<String, String>> nodes
    ) {
    }

    public record StoredHiveConfigFile(
            Path path,
            String relativePath,
            String content,
            long updatedAt,
            Map<String, Map<String, String>> nodes
    ) {
    }

    public static Map<String, String> normalizeAndValidateNodeConf(String kind, Map<String, String> raw) {
        if (raw == null || raw.isEmpty()) {
            return Map.of();
        }
        if (!"HIVE_SQL".equalsIgnoreCase(kind)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "仅 HiveSQL 节点支持配置 Hive 运行参数");
        }
        Map<String, String> normalized = new LinkedHashMap<>();
        for (Map.Entry<String, String> entry : raw.entrySet()) {
            String key = validateKey(entry.getKey());
            if (normalized.containsKey(key)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Hive 运行参数名重复: " + key);
            }
            normalized.put(key, validateValue(key, entry.getValue()));
        }
        return Collections.unmodifiableMap(normalized);
    }

    private static String validateKey(String rawKey) {
        if (rawKey == null || rawKey.trim().isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Hive 运行参数名不能为空");
        }
        String key = rawKey.trim();
        if (key.length() > MAX_KEY_LENGTH || !KEY_PATTERN.matcher(key).matches()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Hive 运行参数名不合法: " + key);
        }
        return key;
    }

    private static String validateValue(String key, String value) {
        if (value == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Hive 运行参数值不能为 null: " + key);
        }
        if (value.indexOf('\n') >= 0 || value.indexOf('\r') >= 0 || value.indexOf('\0') >= 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Hive 运行参数值不能包含换行或空字符: " + key);
        }
        return value;
    }

    public Optional<StoredHiveConfigFile> read(Path repoPath, String flowPath) throws IOException {
        return read(repoPath, flowPath, new WorkingTreeSnapshotFileAccess());
    }

    public Optional<StoredHiveConfigFile> read(Path repoPath, String flowPath, SnapshotFileAccess fileAccess)
            throws IOException {
        Path configFile = resolveConfigFile(repoPath, flowPath);
        String relativePath = repoPath.relativize(configFile).toString().replace('\\', '/');
        if (!fileAccess.exists(repoPath, relativePath)) {
            return Optional.empty();
        }
        String content = fileAccess.readString(repoPath, relativePath);
        HiveConfigFile parsed = objectMapper.readValue(content, HiveConfigFile.class);
        Map<String, Map<String, String>> normalizedNodes = new LinkedHashMap<>();
        if (parsed != null && parsed.nodes() != null) {
            for (Map.Entry<String, Map<String, String>> entry : parsed.nodes().entrySet()) {
                if (entry.getKey() == null || entry.getKey().isBlank() || entry.getValue() == null) {
                    continue;
                }
                Map<String, String> conf = new LinkedHashMap<>();
                for (Map.Entry<String, String> kv : entry.getValue().entrySet()) {
                    if (kv.getKey() == null || kv.getKey().isBlank() || kv.getValue() == null) {
                        continue;
                    }
                    String key = validateKey(kv.getKey());
                    if (conf.containsKey(key)) {
                        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Hive 运行参数名重复: " + key);
                    }
                    conf.put(key, validateValue(key, kv.getValue()));
                }
                if (!conf.isEmpty()) {
                    normalizedNodes.put(entry.getKey(), Collections.unmodifiableMap(conf));
                }
            }
        }
        long updatedAt = fileAccess.lastModified(repoPath, relativePath);
        return Optional.of(new StoredHiveConfigFile(
                configFile,
                relativePath,
                content,
                updatedAt,
                Collections.unmodifiableMap(normalizedNodes)
        ));
    }

    public void writeForNodes(Path repoPath, String flowPath, List<OfflineFlowNode> nodes) throws IOException {
        Map<String, Map<String, String>> nodeConfigs = new LinkedHashMap<>();
        for (OfflineFlowNode node : nodes) {
            Map<String, String> normalized = normalizeAndValidateNodeConf(node.kind(), node.hiveConf());
            if (!normalized.isEmpty()) {
                nodeConfigs.put(node.taskId(), normalized);
            }
        }
        Path configFile = resolveConfigFile(repoPath, flowPath);
        if (nodeConfigs.isEmpty()) {
            Files.deleteIfExists(configFile);
            return;
        }
        Files.createDirectories(configFile.getParent());
        String json = objectMapper.writerWithDefaultPrettyPrinter()
                .writeValueAsString(new HiveConfigFile(SCHEMA_VERSION, nodeConfigs));
        Files.writeString(configFile, json + "\n", StandardCharsets.UTF_8);
    }

    public Path resolveConfigFile(Path repoPath, String flowPath) {
        if (flowPath == null || flowPath.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "任务路径不能为空");
        }
        Path flowFile = Path.of(flowPath).normalize();
        Path parent = flowFile.getParent();
        Path configRelative = parent != null ? parent.resolve(FILE_NAME) : Path.of(FILE_NAME);
        Path resolved = repoPath.resolve(configRelative).normalize();
        if (!resolved.startsWith(repoPath)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Hive 配置文件路径不合法");
        }
        return resolved;
    }

    public String resolveRelativePath(Path repoPath, String flowPath) {
        return repoPath.relativize(resolveConfigFile(repoPath, flowPath)).toString().replace('\\', '/');
    }
}
