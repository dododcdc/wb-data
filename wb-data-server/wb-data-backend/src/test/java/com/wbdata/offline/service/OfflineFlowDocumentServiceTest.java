package com.wbdata.offline.service;

import com.wbdata.datasource.service.DataSourceService;
import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.dto.NodePosition;
import com.wbdata.offline.dto.SaveOfflineFlowDocumentRequest;
import com.wbdata.offline.dto.SaveOfflineFlowEdgeRequest;
import com.wbdata.offline.dto.SaveOfflineFlowNodeRequest;
import com.wbdata.offline.dto.SaveOfflineFlowStageRequest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;

class OfflineFlowDocumentServiceTest {

    @TempDir
    Path tempDir;

    @Test
    void rejectsInvalidGraphBeforeWritingFlowScriptsOrLayout() throws Exception {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");

        Path repoRoot = properties.resolveRepoPath(42L);
        Path flowDir = repoRoot.resolve("_flows/demo");
        Files.createDirectories(flowDir);

        Path flowFile = flowDir.resolve("flow.yaml");
        String originalFlow = new OfflineFlowYamlSupport().buildEmptyFlowYaml("demo", "pg-42");
        Files.writeString(flowFile, originalFlow, StandardCharsets.UTF_8);

        OfflineFlowDocumentService service = new OfflineFlowDocumentService(
                properties,
                new OfflineFlowContentService(properties),
                mock(DataSourceService.class)
        );

        SaveOfflineFlowDocumentRequest request = new SaveOfflineFlowDocumentRequest(
                42L,
                "_flows/demo/flow.yaml",
                null,
                0L,
                List.of(new SaveOfflineFlowStageRequest(
                        "stage-1",
                        List.of(
                                new SaveOfflineFlowNodeRequest("a", "echo a", "SHELL", "scripts/demo/a.sh", null, null),
                                new SaveOfflineFlowNodeRequest("b", "echo b", "SHELL", "scripts/demo/b.sh", null, null),
                                new SaveOfflineFlowNodeRequest("c", "echo c", "SQL", "scripts/demo/c.sql", null, null)
                        )
                )),
                List.of(new SaveOfflineFlowEdgeRequest("a", "b")),
                Map.of(
                        "a", new NodePosition(0, 0),
                        "b", new NodePosition(100, 0),
                        "c", new NodePosition(200, 0)
                )
        );

        ResponseStatusException ex = assertThrows(ResponseStatusException.class, () -> service.saveFlowDocument(request));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatusCode());
        assertEquals(
                "当前 Flow 存在未明确配置的依赖关系，请先在画布中补全依赖线后再保存。",
                ex.getReason()
        );

        assertEquals(originalFlow, Files.readString(flowFile, StandardCharsets.UTF_8));
        assertFalse(Files.exists(repoRoot.resolve("scripts/demo/a.sh")));
        assertFalse(Files.exists(repoRoot.resolve("scripts/demo/b.sh")));
        assertFalse(Files.exists(repoRoot.resolve("scripts/demo/c.sql")));
        assertFalse(Files.exists(flowDir.resolve(".layout.json")));
    }
}
