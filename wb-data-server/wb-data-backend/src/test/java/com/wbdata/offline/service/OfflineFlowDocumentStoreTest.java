package com.wbdata.offline.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.dto.OfflineFlowDocumentResponse;
import com.wbdata.offline.parameter.service.FlowParameterBindingAssembler;
import com.wbdata.offline.parameter.service.FlowParameterSnapshotStore;
import com.wbdata.offline.service.OfflineFlowDocumentStore.DocumentSnapshot;
import com.wbdata.offline.transfer.service.TransferConfigFileService;
import com.wbdata.parameter.service.ParameterGroupService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

class OfflineFlowDocumentStoreTest {

    @TempDir
    Path tempDir;

    private OfflineFlowDocumentStore createStore() {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        ObjectMapper objectMapper = new ObjectMapper();
        FlowParameterSnapshotStore paramStore = new FlowParameterSnapshotStore(objectMapper);
        return new OfflineFlowDocumentStore(
                properties,
                new OfflineKestraFlowFileService(properties),
                new TransferConfigFileService(objectMapper),
                paramStore,
                new FlowParameterBindingAssembler(mock(ParameterGroupService.class), paramStore),
                new OfflineHiveConfigStore(objectMapper),
                new OfflineFlowYamlSupport(),
                objectMapper
        );
    }

    private DocumentSnapshot snapshot(String hash, long updatedAt) {
        OfflineFlowDocumentResponse response = new OfflineFlowDocumentResponse(
                1L, "_flows/demo/flow.yaml", "demo", "pg-1", hash, updatedAt,
                List.of(), List.of(), Map.of(), null, null, "Asia/Shanghai", null);
        return new DocumentSnapshot(response, Map.of(), Set.of(), List.of(), List.of());
    }

    @Test
    void assertOptimisticLockAllowsNullHashAndMatchingSnapshot() {
        OfflineFlowDocumentStore store = createStore();
        DocumentSnapshot snap = snapshot("abc", 100L);

        store.assertOptimisticLock(null, null, 100L);
        store.assertOptimisticLock(snap, "abc", null);
        store.assertOptimisticLock(snap, "abc", 100L);
    }

    @Test
    void assertOptimisticLockRejectsMissingSnapshotHashMismatchAndTimestampMismatch() {
        OfflineFlowDocumentStore store = createStore();
        DocumentSnapshot snap = snapshot("abc", 100L);

        assertThatThrownBy(() -> store.assertOptimisticLock(null, "abc", 100L))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.CONFLICT));

        assertThatThrownBy(() -> store.assertOptimisticLock(snap, "different", 100L))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.CONFLICT));

        assertThatThrownBy(() -> store.assertOptimisticLock(snap, "abc", 200L))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.CONFLICT));
    }

    @Test
    void resolveRepoFileAndLayoutFileRejectTraversalOutsideRepo() {
        OfflineFlowDocumentStore store = createStore();
        Path repo = tempDir.resolve("wb-data-1").toAbsolutePath().normalize();

        assertThat(store.resolveRepoFile(repo, "scripts/demo/a.sql"))
                .isEqualTo(repo.resolve("scripts/demo/a.sql"));
        assertThat(store.resolveLayoutFile(repo, "_flows/demo/flow.yaml"))
                .isEqualTo(repo.resolve("_flows/demo/.layout.json"));

        assertThatThrownBy(() -> store.resolveRepoFile(repo, "../outside.sql"))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST));
        assertThatThrownBy(() -> store.resolveRepoFile(repo, "/abs/path.sql"))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST));
        assertThatThrownBy(() -> store.resolveLayoutFile(repo, "../flow.yaml"))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST));
    }
}
