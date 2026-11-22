package com.wbdata.offline.repo.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wbdata.datasource.service.DataSourceService;
import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.config.OfflineTransferProperties;
import com.wbdata.offline.dto.SaveOfflineFlowDocumentRequest;
import com.wbdata.offline.dto.SaveOfflineFlowNodeRequest;
import com.wbdata.offline.dto.SaveOfflineFlowStageRequest;
import com.wbdata.offline.dto.OfflineFlowFileSnapshot;
import com.wbdata.offline.dto.OfflineFlowVersionSnapshotResponse;
import com.wbdata.offline.parameter.service.ExecutionParameterSnapshotRegistry;
import com.wbdata.offline.parameter.service.FlowParameterBindingAssembler;
import com.wbdata.offline.parameter.service.FlowParameterSnapshotStore;
import com.wbdata.offline.service.FlowGraphDraftBuilder;
import com.wbdata.offline.service.OfflineFlowContentService;
import com.wbdata.offline.service.OfflineFlowDocumentService;
import com.wbdata.offline.service.OfflineKestraFlowFileService;
import com.wbdata.offline.transfer.service.TransferConfigFileService;
import com.wbdata.parameter.service.ParameterGroupService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.Mockito;
import org.springframework.web.server.ResponseStatusException;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

class OfflineFlowSnapshotServiceTest {

    private static final String FLOW_PATH = "_flows/example/flow.yaml";

    @TempDir
    Path tempDir;

    @Test
    void readsEachRevisionWithoutMixingWorkingTree() throws Exception {
        Fixture fixture = new Fixture();
        fixture.documentService.saveFlowDocument(saveRequest(List.of(
                node("keep", "echo old"),
                node("remove", "echo removed")
        )));
        String firstRevision = fixture.commit("first");
        fixture.documentService.saveFlowDocument(saveRequest(List.of(
                node("keep", "echo new")
        )));
        String secondRevision = fixture.commit("second");

        OfflineFlowVersionSnapshotResponse first = fixture.snapshotService.getSnapshot(4L, FLOW_PATH, firstRevision);
        OfflineFlowVersionSnapshotResponse second = fixture.snapshotService.getSnapshot(4L, FLOW_PATH, secondRevision);

        assertThat(first.document().stages().getFirst().nodes()).extracting("taskId")
                .containsExactly("keep", "remove");
        assertThat(first.document().stages().getFirst().nodes().getFirst().scriptContent()).isEqualTo("echo old");
        assertThat(first.document().stages().getFirst().nodes().get(1).scriptContent()).isEqualTo("echo removed");
        assertThat(second.document().stages().getFirst().nodes()).extracting("taskId").containsExactly("keep");
        assertThat(second.document().stages().getFirst().nodes().getFirst().scriptContent()).isEqualTo("echo new");
        assertThat(first.document().parameterBinding().currentVersion()).isNull();
        assertThat(first.document().parameterBinding().status()).isNull();
        assertThat(first.files()).extracting(OfflineFlowFileSnapshot::path).contains("scripts/example/remove.sh");

        OfflineFlowFileSnapshot removed = fixture.snapshotService.getFile(
                4L, FLOW_PATH, firstRevision, "scripts/example/remove.sh");
        assertThat(removed.content()).isEqualTo("echo removed");
        assertThatThrownBy(() -> fixture.snapshotService.getFile(4L, FLOW_PATH, secondRevision, "scripts/example/remove.sh"))
                .isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> fixture.snapshotService.getSnapshot(4L, FLOW_PATH, "main"))
                .isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> fixture.snapshotService.getFile(4L, FLOW_PATH, firstRevision, ".git/config"))
                .isInstanceOf(ResponseStatusException.class);
    }

    private SaveOfflineFlowDocumentRequest saveRequest(List<SaveOfflineFlowNodeRequest> nodes) {
        return new SaveOfflineFlowDocumentRequest(
                4L,
                FLOW_PATH,
                null,
                0,
                List.of(new SaveOfflineFlowStageRequest("stage-1", nodes)),
                List.of(),
                java.util.Map.of(),
                null,
                null,
                null,
                "Asia/Shanghai",
                null
        );
    }

    private SaveOfflineFlowNodeRequest node(String taskId, String content) {
        return new SaveOfflineFlowNodeRequest(
                taskId,
                content,
                "SHELL",
                "scripts/example/" + taskId + ".sh",
                null,
                null
        );
    }

    private class Fixture {
        private final OfflineProperties properties = new OfflineProperties();
        private final OfflineFlowDocumentService documentService;
        private final OfflineFlowSnapshotService snapshotService;
        private final Path repo;

        private Fixture() throws Exception {
            properties.setRepoBaseDir(tempDir.toString());
            properties.setRepoDirPrefix("wb-data-");
            repo = properties.resolveRepoPath(4L);
            initRepo(repo);
            RepoLockManager lockManager = new RepoLockManager();
            OfflineKestraFlowFileService kestraFlowFileService = new OfflineKestraFlowFileService(properties);
            FlowParameterSnapshotStore parameterSnapshotStore = new FlowParameterSnapshotStore(new ObjectMapper());
            TransferConfigFileService transferConfigFileService = new TransferConfigFileService(new ObjectMapper());
            ExecutionParameterSnapshotRegistry snapshotRegistry = mock(ExecutionParameterSnapshotRegistry.class);
            documentService = new OfflineFlowDocumentService(
                    properties,
                    new OfflineFlowContentService(properties, lockManager, kestraFlowFileService),
                    lockManager,
                    kestraFlowFileService,
                    transferConfigFileService,
                    parameterSnapshotStore,
                    new FlowParameterBindingAssembler(mock(ParameterGroupService.class), parameterSnapshotStore),
                    new FlowGraphDraftBuilder(mock(DataSourceService.class), transferConfigFileService),
                    snapshotRegistry,
                    new OfflineTransferProperties()
            );
            GitCommandService gitCommandService = new GitCommandService(
                    properties,
                    mock(OfflineGitRemotePort.class),
                    documentService,
                    mock(OfflinePublishHistoryPort.class),
                    lockManager
            );
            snapshotService = new OfflineFlowSnapshotService(documentService, gitCommandService, properties);
            Files.createDirectories(repo.resolve("_flows/example").toAbsolutePath());
            Files.writeString(repo.resolve("_flows/example/.parameters.json"), """
                    {"schemaVersion":2,"runtimeTimezone":"Asia/Shanghai","groupCode":"common","groupVersion":3,"definitions":[{"key":"v_day","valueSource":"CONSTANT","constantValue":"20261108","offsetDays":0,"sortOrder":0}]}
                    """);
        }

        private String commit(String message) throws Exception {
            git(repo, "add", "-A");
            git(repo, "commit", "-m", message);
            return git(repo, "rev-parse", "HEAD");
        }
    }

    private static void initRepo(Path repo) throws Exception {
        Files.createDirectories(repo);
        git(repo, "init", "-b", "main");
        git(repo, "config", "user.name", "WB Test");
        git(repo, "config", "user.email", "wb@example.com");
    }

    private static String git(Path repo, String... args) throws Exception {
        List<String> command = new ArrayList<>();
        command.add("git");
        command.add("-C");
        command.add(repo.toString());
        command.addAll(List.of(args));
        Process process = new ProcessBuilder(command).redirectErrorStream(true).start();
        int exitCode = process.waitFor();
        String output = new String(process.getInputStream().readAllBytes());
        if (exitCode != 0) {
            throw new IllegalStateException(output);
        }
        return output.trim();
    }
}
