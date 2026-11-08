package com.wbdata.offline.repo.service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public class WorkingTreeSnapshotFileAccess implements SnapshotFileAccess {

    @Override
    public boolean exists(Path repoPath, String relativePath) {
        return Files.isRegularFile(repoPath.resolve(relativePath).normalize());
    }

    @Override
    public String readString(Path repoPath, String relativePath) throws IOException {
        return Files.readString(repoPath.resolve(relativePath).normalize(), StandardCharsets.UTF_8);
    }

    @Override
    public long lastModified(Path repoPath, String relativePath) throws IOException {
        return Files.getLastModifiedTime(repoPath.resolve(relativePath).normalize()).toMillis();
    }
}
