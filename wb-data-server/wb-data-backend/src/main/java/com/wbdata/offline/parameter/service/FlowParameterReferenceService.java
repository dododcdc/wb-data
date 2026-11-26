package com.wbdata.offline.parameter.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.repo.service.RepoLockManager;
import com.wbdata.parameter.dto.ParameterGroupReferencesResponse;
import com.wbdata.parameter.service.ParameterGroupReferencePort;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

@Service
public class FlowParameterReferenceService implements ParameterGroupReferencePort {
    private static final String FLOWS_DIR_NAME = "_flows";
    private static final String SNAPSHOT_FILE_NAME = ".parameters.json";
    private static final int SAMPLE_LIMIT = 5;

    private final OfflineProperties offlineProperties;
    private final ObjectMapper objectMapper;
    private final RepoLockManager repoLockManager;

    @Autowired
    public FlowParameterReferenceService(OfflineProperties offlineProperties,
                                         ObjectMapper objectMapper,
                                         RepoLockManager repoLockManager) {
        this.offlineProperties = offlineProperties;
        this.objectMapper = objectMapper;
        this.repoLockManager = repoLockManager;
    }

    FlowParameterReferenceService(OfflineProperties offlineProperties, ObjectMapper objectMapper) {
        this(offlineProperties, objectMapper, new RepoLockManager());
    }

    @Override
    public ParameterGroupReferencesResponse findReferences(Long groupId, String parameterGroupCode) {
        References refs = scan(groupId, parameterGroupCode);
        return new ParameterGroupReferencesResponse(refs.totalCount(), refs.sampleFlows());
    }

    public References scan(Long groupId, String groupCode) {
        return repoLockManager.withLock(groupId, () -> scanUnlocked(groupId, groupCode));
    }

    private References scanUnlocked(Long groupId, String groupCode) {
        Path repoPath = offlineProperties.resolveRepoPath(groupId);
        Path flowsDir = repoPath.resolve(FLOWS_DIR_NAME);
        if (!Files.isDirectory(flowsDir)) {
            return new References(0, List.of());
        }
        List<String> flows = new ArrayList<>();
        try {
            Files.walkFileTree(flowsDir, new SimpleFileVisitor<>() {
                @Override
                public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) {
                    if (!dir.equals(flowsDir) && dir.getFileName().toString().startsWith(".")) {
                        return FileVisitResult.SKIP_SUBTREE;
                    }
                    return FileVisitResult.CONTINUE;
                }

                @Override
                public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
                    if (SNAPSHOT_FILE_NAME.equals(file.getFileName().toString())
                            && referencesGroup(file, groupCode)) {
                        flows.add(repoPath.relativize(file.getParent()).toString().replace('\\', '/'));
                    }
                    return FileVisitResult.CONTINUE;
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
