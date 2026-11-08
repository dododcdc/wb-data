package com.wbdata.offline.repo.service;

import java.nio.file.Path;

public class GitRevisionSnapshotFileAccess implements SnapshotFileAccess {

    private final Long groupId;
    private final String revision;
    private final GitCommandService gitCommandService;

    public GitRevisionSnapshotFileAccess(Long groupId, String revision, GitCommandService gitCommandService) {
        this.groupId = groupId;
        this.revision = revision;
        this.gitCommandService = gitCommandService;
    }

    @Override
    public boolean exists(Path repoPath, String relativePath) {
        try {
            gitCommandService.readFileAtRevision(groupId, revision, relativePath);
            return true;
        } catch (RuntimeException ex) {
            return false;
        }
    }

    @Override
    public String readString(Path repoPath, String relativePath) {
        return gitCommandService.readFileAtRevision(groupId, revision, relativePath);
    }

    @Override
    public long lastModified(Path repoPath, String relativePath) {
        return 0;
    }
}
