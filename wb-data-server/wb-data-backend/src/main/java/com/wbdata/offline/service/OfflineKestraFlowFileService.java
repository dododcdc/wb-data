package com.wbdata.offline.service;

import com.wbdata.offline.config.OfflineProperties;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

@Service
@RequiredArgsConstructor
public class OfflineKestraFlowFileService {

    private static final String KESTRA_FLOW_DIR = ".wb-data/kestra-flows";

    private final OfflineProperties offlineProperties;

    public void syncFlowFile(Long groupId, String flowPath) throws IOException {
        syncFlowFile(offlineProperties.resolveRepoPath(groupId), flowPath);
    }

    public void syncFlowFile(Path repoPath, String flowPath) throws IOException {
        Path flowFile = resolveRepoFile(repoPath, flowPath);
        if (!Files.isRegularFile(flowFile)) {
            return;
        }
        Path kestraFlowFile = resolveFlowFile(repoPath, flowPath);
        Files.createDirectories(kestraFlowFile.getParent());
        Files.writeString(kestraFlowFile, Files.readString(flowFile, StandardCharsets.UTF_8), StandardCharsets.UTF_8);
    }

    public Path resolveFlowFile(Path repoPath, String flowPath) {
        return resolveRepoFile(repoPath, KESTRA_FLOW_DIR + "/" + extractFlowId(flowPath) + ".yaml");
    }

    private String extractFlowId(String path) {
        String[] parts = path.split("/");
        if (parts.length >= 2) {
            return parts[parts.length - 2];
        }
        return "flow";
    }

    private Path resolveRepoFile(Path repoPath, String path) {
        if (path == null || path.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Flow 路径不能为空");
        }
        Path relativePath = Path.of(path).normalize();
        if (relativePath.isAbsolute()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Flow 路径不合法");
        }

        Path resolvedPath = repoPath.resolve(relativePath).normalize();
        if (!resolvedPath.startsWith(repoPath)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Flow 路径不合法");
        }
        return resolvedPath;
    }
}
