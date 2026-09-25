package com.wbdata.offline.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wbdata.offline.config.OfflineProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

class FlowParameterReferenceServiceTest {
    @TempDir
    Path repoBaseDir;

    private FlowParameterReferenceService service;

    @BeforeEach
    void createService() {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(repoBaseDir.toString());
        service = new FlowParameterReferenceService(properties, new ObjectMapper());
    }

    @Test
    void returnsEmptyWhenRepoDoesNotExist() {
        assertThat(service.scan(1L, "crm").totalCount()).isZero();
    }

    @Test
    void countsTopLevelAndNestedBindingMatchesAndSamplesSortedFlows() throws Exception {
        Path repo = repoBaseDir.resolve("wb-data-1");
        writeSnapshot(repo, "_flows/alpha", "{\"schemaVersion\":2,\"groupCode\":\"crm\",\"groupVersion\":1}");
        writeSnapshot(repo, "_flows/beta", """
                {"schemaVersion":2,"groupCode":"other","groupVersion":2,
                 "groups":[{"groupCode":"crm","groupVersion":1},{"groupCode":"other","groupVersion":2}]}
                """);
        writeSnapshot(repo, "_flows/gamma", "{\"schemaVersion\":2,\"groupCode\":\"other\",\"groupVersion\":2}");
        writeSnapshot(repo, "_flows/broken", "not-json");

        FlowParameterReferenceService.References references = service.scan(1L, "crm");

        assertThat(references.totalCount()).isEqualTo(2);
        assertThat(references.sampleFlows()).containsExactly("_flows/alpha", "_flows/beta");
    }

    @Test
    void limitsSampleToFiveWhileKeepingTotalCount() throws Exception {
        Path repo = repoBaseDir.resolve("wb-data-1");
        for (int i = 0; i < 7; i++) {
            writeSnapshot(repo, "_flows/flow-" + (char) ('a' + i),
                    "{\"schemaVersion\":2,\"groupCode\":\"crm\",\"groupVersion\":1}");
        }

        FlowParameterReferenceService.References references = service.scan(1L, "crm");

        assertThat(references.totalCount()).isEqualTo(7);
        assertThat(references.sampleFlows()).hasSize(5);
    }

    private void writeSnapshot(Path repo, String flowDir, String content) throws Exception {
        Path dir = repo.resolve(flowDir);
        Files.createDirectories(dir);
        Files.writeString(dir.resolve(".parameters.json"), content);
    }
}
