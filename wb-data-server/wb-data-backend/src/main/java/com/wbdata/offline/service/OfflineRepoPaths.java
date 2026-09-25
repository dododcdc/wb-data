package com.wbdata.offline.service;

import java.nio.file.Path;

final class OfflineRepoPaths {

    private OfflineRepoPaths() {
    }

    static void assertValidSegments(Path relativePath) {
        for (Path segment : relativePath) {
            String name = segment.toString();
            if (name.isBlank() || ".".equals(name) || "..".equals(name)
                    || name.contains("/") || name.contains("\\")) {
                throw new IllegalArgumentException("路径包含非法目录名: " + name);
            }
        }
    }
}
