package com.wbdata.offline.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.web.server.ResponseStatusException;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class OfflineHiveConfigStoreTest {

    @TempDir
    Path tempDir;

    private final OfflineHiveConfigStore store = new OfflineHiveConfigStore(new ObjectMapper());

    @Test
    void writeForNodesPersistsOrderedConfAndDeletesFileWhenCleared() throws Exception {
        String flowPath = "_flows/demo/flow.yaml";
        Files.createDirectories(tempDir.resolve("_flows/demo"));

        Map<String, String> ordered = new LinkedHashMap<>();
        ordered.put("hive.exec.dynamic.partition", "true");
        ordered.put("hive.exec.dynamic.partition.mode", "nonstrict");

        store.writeForNodes(tempDir, flowPath, List.of(
                new OfflineFlowNode("hive_node", "HIVE_SQL", "scripts/demo/hive_node.sql", 2L, "HIVE", null, ordered),
                new OfflineFlowNode("shell_node", "SHELL", "scripts/demo/shell_node.sh", null, null, null)
        ));

        Path sidecar = tempDir.resolve("_flows/demo/.hive-conf.json");
        assertThat(sidecar).exists();
        var loaded = store.read(tempDir, flowPath);
        assertThat(loaded).isPresent();
        assertThat(loaded.get().nodes().get("hive_node").keySet())
                .containsExactly("hive.exec.dynamic.partition", "hive.exec.dynamic.partition.mode");
        assertThat(loaded.get().nodes().get("hive_node"))
                .containsEntry("hive.exec.dynamic.partition.mode", "nonstrict");

        // Clearing removes the sidecar cleanly
        store.writeForNodes(tempDir, flowPath, List.of(
                new OfflineFlowNode("hive_node", "HIVE_SQL", "scripts/demo/hive_node.sql", 2L, "HIVE", null, Map.of())
        ));
        assertThat(sidecar).doesNotExist();
        assertThat(store.read(tempDir, flowPath)).isEmpty();
    }

    @Test
    void normalizeRejectsNonHiveKindsInvalidKeysAndControlChars() {
        assertThatThrownBy(() -> OfflineHiveConfigStore.normalizeAndValidateNodeConf(
                "MYSQL", Map.of("hive.exec.dynamic.partition", "true")))
                .isInstanceOf(ResponseStatusException.class);

        assertThatThrownBy(() -> OfflineHiveConfigStore.normalizeAndValidateNodeConf(
                "HIVE_SQL", Map.of("bad key with space", "1")))
                .isInstanceOf(ResponseStatusException.class);

        assertThatThrownBy(() -> OfflineHiveConfigStore.normalizeAndValidateNodeConf(
                "HIVE_SQL", Map.of("hive.foo", "line1\nline2")))
                .isInstanceOf(ResponseStatusException.class);

        Map<String, String> duplicateAfterTrim = new LinkedHashMap<>();
        duplicateAfterTrim.put("hive.foo", "1");
        duplicateAfterTrim.put(" hive.foo ", "2");
        assertThatThrownBy(() -> OfflineHiveConfigStore.normalizeAndValidateNodeConf("HIVE_SQL", duplicateAfterTrim))
                .isInstanceOf(ResponseStatusException.class);
    }

    @Test
    void readRejectsInvalidKeysControlCharsAndDuplicateTrimmedKeys() throws Exception {
        String flowPath = "_flows/demo/flow.yaml";
        Path sidecar = tempDir.resolve("_flows/demo/.hive-conf.json");
        Files.createDirectories(sidecar.getParent());

        Files.writeString(sidecar, """
                {
                  "schemaVersion": 1,
                  "nodes": {
                    "hive_node": {
                      "bad key with space": "1"
                    }
                  }
                }
                """);
        assertThatThrownBy(() -> store.read(tempDir, flowPath))
                .isInstanceOf(ResponseStatusException.class);

        Files.writeString(sidecar, """
                {
                  "schemaVersion": 1,
                  "nodes": {
                    "hive_node": {
                      "hive.foo": "line1\\nline2"
                    }
                  }
                }
                """);
        assertThatThrownBy(() -> store.read(tempDir, flowPath))
                .isInstanceOf(ResponseStatusException.class);

        Files.writeString(sidecar, """
                {
                  "schemaVersion": 1,
                  "nodes": {
                    "hive_node": {
                      "hive.foo": "1",
                      " hive.foo ": "2"
                    }
                  }
                }
                """);
        assertThatThrownBy(() -> store.read(tempDir, flowPath))
                .isInstanceOf(ResponseStatusException.class);
    }
}
