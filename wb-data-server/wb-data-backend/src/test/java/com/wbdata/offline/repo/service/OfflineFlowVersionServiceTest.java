package com.wbdata.offline.repo.service;

import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.dto.OfflineFlowVersionHistoryResponse;
import com.wbdata.offline.dto.OfflineFlowVersionItem;
import com.wbdata.offline.service.OfflineFlowDocumentService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.Mockito;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

class OfflineFlowVersionServiceTest {

    private static final String FLOW_PATH = "_flows/example/flow.yaml";

    @TempDir
    Path tempDir;

    @Test
    void mapsTenCommitsToTwoOnlineVersionsAndSkipsUnrelatedPush() throws Exception {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        OfflineFlowDocumentService flowDocumentService = Mockito.mock(OfflineFlowDocumentService.class);
        when(flowDocumentService.resolveManagedFiles(4L, FLOW_PATH))
                .thenReturn(List.of(FLOW_PATH, "scripts/example/node.sql"));
        OfflinePublishHistoryPort publishHistoryPort = Mockito.mock(OfflinePublishHistoryPort.class);
        OfflineFlowVersionService service = new OfflineFlowVersionService(
                properties, flowDocumentService, publishHistoryPort, new RepoLockManager());

        Path repo = properties.resolveRepoPath(4L);
        Path remote = tempDir.resolve("remote.git");
        git(tempDir, "init", "--bare", remote.toString());
        initRepo(repo);
        git(repo, "remote", "add", "origin", remote.toUri().toString());

        List<String> shas = new ArrayList<>();
        List<OfflinePublishHistoryPort.PublishEntry> records = new ArrayList<>();
        String previousPushedSha = null;
        for (int index = 1; index <= 10; index++) {
            write(repo, FLOW_PATH, "id: example\nnamespace: pg-4\ntasks: []\n# c" + index + "\n");
            write(repo, "scripts/example/node.sql", "select " + index + ";\n");
            git(repo, "add", "-A");
            git(repo, "commit", "-m", "task c" + index);
            shas.add(git(repo, "rev-parse", "HEAD"));
            if (index == 4 || index == 9) {
                git(repo, "push", "-u", "origin", "HEAD");
                records.add(publish(records.size() + 1L, previousPushedSha, shas.getLast(), records.size() + 1));
                previousPushedSha = shas.getLast();
            }
        }
        OfflinePublishHistoryPort.SyncDeploymentState deploymentState =
                new OfflinePublishHistoryPort.SyncDeploymentState("CONFIRMED", shas.get(8));
        when(publishHistoryPort.loadBranchPublishHistory(4L, "main"))
                .thenAnswer(ignored -> new OfflinePublishHistoryPort.BranchPublishHistory(deploymentState, List.copyOf(records)));
        write(repo, FLOW_PATH, "id: example\nnamespace: pg-4\ntasks: []\n# development\n");

        OfflineFlowVersionHistoryResponse response = service.getVersions(4L, FLOW_PATH, false, 1, 50);

        assertThat(response.total()).isEqualTo(10);
        assertThat(response.items().getFirst().kind()).isEqualTo("DEVELOPMENT");
        assertThat(response.items().getFirst().dirty()).isTrue();
        assertThat(publication(response, shas.get(3)).onlineVersion()).isEqualTo(1);
        assertThat(publication(response, shas.get(8)).onlineVersion()).isEqualTo(2);
        assertThat(publication(response, shas.get(8)).currentOnline()).isTrue();
        assertThat(publication(response, shas.get(3)).currentOnline()).isFalse();
        assertThat(version(response, shas.get(9)).publications()).isEmpty();

        OfflineFlowVersionHistoryResponse onlineOnly = service.getVersions(4L, FLOW_PATH, true, 1, 50);
        assertThat(onlineOnly.total()).isEqualTo(2);
        assertThat(onlineOnly.items()).extracting(OfflineFlowVersionItem::revision)
                .containsExactly(shas.get(8), shas.get(3));

        write(repo, "unrelated.txt", "other\n");
        git(repo, "add", "--", "unrelated.txt");
        git(repo, "commit", "-m", "unrelated c11");
        git(repo, "push", "-u", "origin", "HEAD");
        records.add(publish(3L, previousPushedSha, git(repo, "rev-parse", "HEAD"), 3));
        previousPushedSha = git(repo, "rev-parse", "HEAD");
        write(repo, "unrelated.txt", "other again\n");
        git(repo, "add", "--", "unrelated.txt");
        git(repo, "commit", "-m", "unrelated c12");
        git(repo, "push", "-u", "origin", "HEAD");
        records.add(publish(4L, previousPushedSha, git(repo, "rev-parse", "HEAD"), 4));

        OfflineFlowVersionHistoryResponse afterUnrelatedPushes = service.getVersions(4L, FLOW_PATH, true, 1, 50);
        assertThat(afterUnrelatedPushes.total()).isEqualTo(3);
        assertThat(publication(afterUnrelatedPushes, shas.get(9)).onlineVersion()).isEqualTo(3);
        assertThat(afterUnrelatedPushes.items()).extracting(OfflineFlowVersionItem::revision)
                .containsExactly(shas.get(9), shas.get(8), shas.get(3));
    }

    private OfflinePublishHistoryPort.PublishEntry publish(Long id, String beforeSha, String afterSha, int day) {
        return new OfflinePublishHistoryPort.PublishEntry(
                id,
                beforeSha,
                afterSha,
                LocalDateTime.of(2026, 1, day, 1, 0),
                "SUCCESS"
        );
    }

    private OfflineFlowVersionItem version(OfflineFlowVersionHistoryResponse response, String sha) {
        return response.items().stream().filter(item -> item.revision().equals(sha)).findFirst().orElseThrow();
    }

    private com.wbdata.offline.dto.OfflineFlowPublicationItem publication(
            OfflineFlowVersionHistoryResponse response, String sha) {
        return version(response, sha).publications().getFirst();
    }

    private static void initRepo(Path repo) throws Exception {
        Files.createDirectories(repo);
        git(repo, "init", "-b", "main");
        git(repo, "config", "user.name", "WB Test");
        git(repo, "config", "user.email", "wb@example.com");
    }

    private static void write(Path repo, String relative, String content) throws Exception {
        Path file = repo.resolve(relative);
        Files.createDirectories(file.getParent());
        Files.writeString(file, content);
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
