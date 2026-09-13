package com.wbdata.offline.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wbdata.offline.dto.FlowParameterDefinitionSnapshot;
import com.wbdata.offline.dto.FlowParameterSnapshot;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.web.server.ResponseStatusException;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class FlowParameterSnapshotStoreTest {
    @TempDir
    Path tempDir;

    private final FlowParameterSnapshotStore store = new FlowParameterSnapshotStore(new ObjectMapper());

    @Test
    void writesAndReadsSchemaVersionTwoSnapshot() throws Exception {
        FlowParameterSnapshot snapshot = new FlowParameterSnapshot(
                2,
                "Asia/Shanghai",
                "daily_common",
                3,
                List.of(new FlowParameterDefinitionSnapshot(
                        "name", "CONSTANT", "小明", null, 0, null, 0, null))
        );

        store.write(tempDir, "_flows/example/flow.yaml", snapshot);

        var stored = store.read(tempDir, "_flows/example/flow.yaml").orElseThrow();
        assertThat(stored.snapshot()).isEqualTo(snapshot);
        assertThat(stored.path()).isEqualTo(tempDir.resolve("_flows/example/.parameters.json"));
    }

    @Test
    void readsLegacySchemaVersionOneTimezoneFromDefinitions() throws Exception {
        Path path = tempDir.resolve("_flows/example/.parameters.json");
        Files.createDirectories(path.getParent());
        Files.writeString(path, """
                {
                  "schemaVersion": 1,
                  "groupCode": "daily",
                  "groupVersion": 1,
                  "definitions": [{
                    "key": "v_day",
                    "dataType": "STRING",
                    "valueSource": "SYSTEM_TIME",
                    "timezone": "Asia/Singapore",
                    "format": "yyyyMMdd",
                    "offsetAmount": 0,
                    "offsetUnit": "DAYS",
                    "sortOrder": 0,
                    "timeBasis": "PLANNED_TIME"
                  }]
                }
                """);

        var stored = store.read(tempDir, "_flows/example/flow.yaml").orElseThrow();

        assertThat(stored.snapshot().schemaVersion()).isEqualTo(1);
        assertThat(stored.snapshot().runtimeTimezone()).isEqualTo("Asia/Singapore");
        assertThat(stored.snapshot().definitions().getFirst().offsetDays()).isZero();
    }

    @Test
    void rejectsUnsupportedOrIncompleteSnapshot() throws Exception {
        Path path = tempDir.resolve("_flows/example/.parameters.json");
        Files.createDirectories(path.getParent());
        Files.writeString(path, "{\"schemaVersion\":3,\"groupCode\":\"daily\",\"groupVersion\":1,\"definitions\":[]}");

        assertThatThrownBy(() -> store.read(tempDir, "_flows/example/flow.yaml"))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("不支持的参数快照版本");

        Files.writeString(path, "{\"schemaVersion\":2,\"groupCode\":\"daily\",\"groupVersion\":1,\"definitions\":[]}");
        assertThatThrownBy(() -> store.read(tempDir, "_flows/example/flow.yaml"))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("缺少任务运行时区");
    }
}
