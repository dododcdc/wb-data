package com.wbdata.offline.parameter.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.repo.service.RepoLockManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.Mockito;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;

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

    @Test
    void scansOnlyNonHiddenSubtreesInsideFlowsDirectoryUnderGroupLock() throws Exception {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(repoBaseDir.toString());
        RepoLockManager lockManager = Mockito.spy(new RepoLockManager());
        FlowParameterReferenceService lockedService = new FlowParameterReferenceService(
                properties, new ObjectMapper(), lockManager);

        Path repo = repoBaseDir.resolve("wb-data-1");
        String matchingJson = "{\"schemaVersion\":2,\"groupCode\":\"crm\",\"groupVersion\":1}";
        writeSnapshot(repo, "_flows/valid_flow", matchingJson);
        writeSnapshot(repo, "_flows/.hidden_dir/ignored_flow", matchingJson);
        writeSnapshot(repo, ".git/objects/decoy", matchingJson);
        writeSnapshot(repo, "scripts/decoy", matchingJson);
        writeSnapshot(repo, ".wb-data/kestra-flows/decoy", matchingJson);

        FlowParameterReferenceService.References references = lockedService.scan(1L, "crm");

        assertThat(references.totalCount()).isEqualTo(1);
        assertThat(references.sampleFlows()).containsExactly("_flows/valid_flow");
        verify(lockManager).withLock(eq(1L), Mockito.<java.util.function.Supplier<?>>any());
    }

    private void writeSnapshot(Path repo, String flowDir, String content) throws Exception {
        Path dir = repo.resolve(flowDir);
        Files.createDirectories(dir);
        Files.writeString(dir.resolve(".parameters.json"), content);
    }
}
