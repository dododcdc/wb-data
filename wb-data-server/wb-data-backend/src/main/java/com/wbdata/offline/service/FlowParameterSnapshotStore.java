package com.wbdata.offline.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wbdata.offline.dto.FlowParameterSnapshot;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.ZoneId;
import java.util.Optional;

@Component
@RequiredArgsConstructor
public class FlowParameterSnapshotStore {
    private static final String FILE_NAME = ".parameters.json";

    private final ObjectMapper objectMapper;

    public Optional<SnapshotFile> read(Path repoPath, String flowPath) throws IOException {
        Path path = resolve(repoPath, flowPath);
        if (!Files.isRegularFile(path)) {
            return Optional.empty();
        }
        String content = Files.readString(path, StandardCharsets.UTF_8);
        FlowParameterSnapshot snapshot;
        try {
            snapshot = FlowParameterSnapshotCodec.read(objectMapper, content);
        } catch (FlowParameterSnapshotCodec.UnsupportedSchemaVersionException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "不支持的参数快照版本: " + ex.schemaVersion());
        } catch (JsonProcessingException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "参数快照格式不正确", ex);
        }
        if (snapshot.groupCode() == null || snapshot.groupCode().isBlank()
                || snapshot.groupVersion() < 1 || snapshot.definitions() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "参数快照内容不完整");
        }
        if (snapshot.schemaVersion() == 2) {
            validateRuntimeTimezone(snapshot.runtimeTimezone());
        }
        return Optional.of(new SnapshotFile(
                snapshot,
                path,
                content,
                Files.getLastModifiedTime(path).toMillis()
        ));
    }

    public void write(Path repoPath, String flowPath, FlowParameterSnapshot snapshot) throws IOException {
        if (snapshot.schemaVersion() != 2) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "新参数快照必须使用 schemaVersion 2");
        }
        validateRuntimeTimezone(snapshot.runtimeTimezone());
        Path path = resolve(repoPath, flowPath);
        Files.createDirectories(path.getParent());
        String content = objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(snapshot) + "\n";
        Files.writeString(path, content, StandardCharsets.UTF_8);
    }

    private void validateRuntimeTimezone(String runtimeTimezone) {
        if (runtimeTimezone == null || runtimeTimezone.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "参数快照缺少任务运行时区");
        }
        try {
            ZoneId.of(runtimeTimezone);
        } catch (RuntimeException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "参数快照中的任务运行时区不合法");
        }
    }

    public void delete(Path repoPath, String flowPath) throws IOException {
        Files.deleteIfExists(resolve(repoPath, flowPath));
    }

    public Path resolve(Path repoPath, String flowPath) {
        if (flowPath == null || flowPath.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "任务路径不能为空");
        }
        Path flowFile = Path.of(flowPath).normalize();
        if (flowFile.isAbsolute() || flowFile.getParent() == null
                || !"flow.yaml".equals(flowFile.getFileName().toString())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "任务路径不合法");
        }
        Path resolved = repoPath.resolve(flowFile.getParent()).resolve(FILE_NAME).normalize();
        if (!resolved.startsWith(repoPath)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "参数快照路径不合法");
        }
        return resolved;
    }

    public record SnapshotFile(
            FlowParameterSnapshot snapshot,
            Path path,
            String content,
            long updatedAt
    ) {
    }
}
