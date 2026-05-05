package com.wbdata.offline.service;

import com.wbdata.datasource.service.DataSourceService;
import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.dto.NodePosition;
import com.wbdata.offline.dto.SaveOfflineFlowDocumentRequest;
import com.wbdata.offline.dto.SaveOfflineFlowNodeRequest;
import com.wbdata.offline.dto.SaveOfflineFlowStageRequest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class OfflineFlowDocumentServiceTest {

    @TempDir
    Path tempDir;

    @Test
    void resolveManagedFiles_includesYamlLayoutAndScripts() {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        OfflineFlowDocumentService service = new OfflineFlowDocumentService(
                properties,
                new OfflineFlowContentService(properties),
                mock(DataSourceService.class)
        );

        service.saveFlowDocument(new SaveOfflineFlowDocumentRequest(
                1L,
                "_flows/example/flow.yaml",
                null,
                0L,
                List.of(new SaveOfflineFlowStageRequest(
                        "main",
                        List.of(new SaveOfflineFlowNodeRequest(
                                "node_1",
                                "echo 1",
                                "SHELL",
                                "scripts/example/node_1.sh",
                                null,
                                null
                        ))
                )),
                List.of(),
                Map.of("node_1", new NodePosition(10, 20))
        ));

        assertThat(service.resolveManagedFiles(1L, "_flows/example/flow.yaml"))
                .containsExactlyInAnyOrder(
                        "_flows/example/flow.yaml",
                        "_flows/example/.layout.json",
                        "scripts/example/node_1.sh"
                );
    }
}
