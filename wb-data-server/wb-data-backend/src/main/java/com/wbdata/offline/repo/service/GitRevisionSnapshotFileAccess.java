package com.wbdata.offline.repo.service;

import org.springframework.web.server.ResponseStatusException;

import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

public class GitRevisionSnapshotFileAccess implements SnapshotFileAccess {

    private final Long groupId;
    private final String revision;
    private final GitCommandService gitCommandService;
    private final Map<String, Optional<String>> fileCache = new HashMap<>();

    public GitRevisionSnapshotFileAccess(Long groupId, String revision, GitCommandService gitCommandService) {
        this.groupId = groupId;
        this.revision = revision;
        this.gitCommandService = gitCommandService;
    }

    @Override
    public boolean exists(Path repoPath, String relativePath) {
        return loadOptional(relativePath).isPresent();
    }

    @Override
    public String readString(Path repoPath, String relativePath) {
        return loadOptional(relativePath)
                .orElseThrow(() -> new GitRepositoryOperations.GitException("快照文件不存在: " + relativePath));
    }

    private Optional<String> loadOptional(String relativePath) {
        Optional<String> cached = fileCache.get(relativePath);
        if (cached != null) {
            return cached;
        }
        try {
            String content = gitCommandService.readFileAtRevision(groupId, revision, relativePath);
            Optional<String> present = Optional.ofNullable(content);
            fileCache.put(relativePath, present);
            return present;
        } catch (ResponseStatusException ex) {
            throw ex;
        } catch (GitRepositoryOperations.GitException ex) {
            Optional<String> absent = Optional.empty();
            fileCache.put(relativePath, absent);
            return absent;
        }
    }

    @Override
    public long lastModified(Path repoPath, String relativePath) {
        return 0;
    }
}
