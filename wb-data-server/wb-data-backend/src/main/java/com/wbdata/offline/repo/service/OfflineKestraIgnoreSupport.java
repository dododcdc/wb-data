package com.wbdata.offline.repo.service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * 为 Kestra SyncNamespaceFiles 生成仓库根目录 .kestraignore，
 * 排除 _flows/、.wb-data/、.git/ 与 .gitkeep，仅同步运行期 scripts/ 与 transfers/。
 */
public final class OfflineKestraIgnoreSupport {

    public static final String KESTRA_IGNORE_FILENAME = ".kestraignore";
    public static final String DEFAULT_KESTRA_IGNORE_CONTENT = """
            # Managed by wb-data: sync only runtime scripts and transfer configs to Kestra Namespace Files
            _flows/
            .wb-data/
            .git/
            **/.gitkeep
            """;

    private OfflineKestraIgnoreSupport() {
    }

    public static boolean ensureKestraIgnoreIfMissing(Path repoPath) throws IOException {
        Path ignoreFile = repoPath.resolve(KESTRA_IGNORE_FILENAME);
        if (Files.exists(ignoreFile)) {
            return false;
        }
        Files.writeString(ignoreFile, DEFAULT_KESTRA_IGNORE_CONTENT, StandardCharsets.UTF_8);
        return true;
    }
}
