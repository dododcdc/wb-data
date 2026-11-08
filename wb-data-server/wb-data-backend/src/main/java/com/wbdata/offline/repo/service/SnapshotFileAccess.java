package com.wbdata.offline.repo.service;

import java.io.IOException;
import java.nio.file.Path;

public interface SnapshotFileAccess {

    boolean exists(Path repoPath, String relativePath) throws IOException;

    String readString(Path repoPath, String relativePath) throws IOException;

    long lastModified(Path repoPath, String relativePath) throws IOException;
}
