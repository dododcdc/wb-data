package com.wbdata.offline.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wbdata.offline.config.OfflineProperties;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.stream.Stream;

@Service
@RequiredArgsConstructor
public class FlowParameterReferenceService {
    private static final String SNAPSHOT_FILE_NAME = ".parameters.json";
    private static final int SAMPLE_LIMIT = 5;

    private final OfflineProperties offlineProperties;
    private final ObjectMapper objectMapper;

    public References scan(Long groupId, String groupCode) {
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        if (!Files.isDirectory(repoPath)) {
            return new References(0, List.of());
        }
        List<String> flows = new ArrayList<>();
        try (Stream<Path> stream = Files.walk(repoPath)) {
            stream.filter(Files::isRegularFile)
                    .filter(path -> SNAPSHOT_FILE_NAME.equals(path.getFileName().toString()))
                    .forEach(path -> {
                        if (referencesGroup(path, groupCode)) {
                            flows.add(repoPath.relativize(path.getParent()).toString());
                        }
                    });
        } catch (IOException ex) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "参数组引用统计失败", ex);
        }
        Collections.sort(flows);
        return new References(flows.size(), flows.stream().limit(SAMPLE_LIMIT).toList());
    }

    private boolean referencesGroup(Path snapshotFile, String groupCode) {
        try {
            JsonNode root = objectMapper.readTree(snapshotFile.toFile());
            if (groupCode.equals(root.path("groupCode").asText(null))) {
                return true;
            }
            JsonNode groups = root.path("groups");
            if (groups.isArray()) {
                for (JsonNode group : groups) {
                    if (groupCode.equals(group.path("groupCode").asText(null))) {
                        return true;
                    }
                }
            }
            return false;
        } catch (IOException | RuntimeException ex) {
            return false;
        }
    }

    public record References(int totalCount, List<String> sampleFlows) {
    }
}
