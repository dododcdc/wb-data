package com.wbdata.offline.service;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.transfer.service.TransferConfigFileService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.util.Map;
import java.util.TreeMap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assertions.assertAll;
import static org.mockito.Mockito.mockStatic;

class OfflineFlowContentServiceTest {
    @TempDir
    Path tempDir;

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {" ", "not-a-flow.yaml", "_flows/task", "../outside/flow.yaml",
            "../../escaped/flow.yaml", "other/task/flow.yaml", "scripts/task/flow.yaml",
            "_flows/example/flow.yaml/nested/flow.yaml", "_flows/bad\\name/flow.yaml",
            "_flows/unused/../renamed/flow.yaml", "_flows/./renamed/flow.yaml"})
    void moveRejectsIllegalDestinationBeforeMovingAnyFiles(String newPath) throws Exception {
        assertMoveRejectedWithoutChanges(newPath);
    }

    @Test
    void moveRejectsAbsoluteDestinationBeforeMovingAnyFiles() throws Exception {
        assertMoveRejectedWithoutChanges(tempDir.resolve("escaped/flow.yaml").toString());
    }

    @Test
    void moveRejectsDestinationInsideOwnDirectory() throws Exception {
        assertMoveRejectedWithoutChanges("_flows/example/sub/flow.yaml");
    }

    private void assertMoveRejectedWithoutChanges(String newPath) throws Exception {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        OfflineFlowContentService service = new OfflineFlowContentService(
                properties, new RepoLockManager(), new OfflineKestraFlowFileService(properties));
        Path repo = properties.resolveRepoPath(1L);
        Path flowDir = repo.resolve("_flows/example");
        Path scriptsDir = repo.resolve("scripts/example");
        Files.createDirectories(flowDir);
        Files.createDirectories(scriptsDir);
        Files.writeString(flowDir.resolve("flow.yaml"), "id: example\ntasks: []\n");
        Files.writeString(flowDir.resolve(".parameters.json"), "{\"schemaVersion\":1}\n");
        Files.writeString(scriptsDir.resolve("node.sh"), "echo 1\n");
        Files.writeString(tempDir.resolve("unrelated.txt"), "unrelated");
        Map<String, String> before = files();

        assertAll(
                () -> assertThatThrownBy(() -> service.moveFlow(1L, "_flows/example/flow.yaml", newPath))
                        .isInstanceOf(IllegalArgumentException.class),
                () -> assertThat(files()).isEqualTo(before)
        );
    }

    @Test
    void moveRejectsExistingDestinationDirectory() throws Exception {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        OfflineFlowContentService service = new OfflineFlowContentService(
                properties, new RepoLockManager(), new OfflineKestraFlowFileService(properties));
        Path repo = properties.resolveRepoPath(1L);
        Files.createDirectories(repo.resolve("_flows/example"));
        Files.writeString(repo.resolve("_flows/example/flow.yaml"), "id: example\n");
        Files.createDirectories(repo.resolve("_flows/taken"));

        assertThatThrownBy(() -> service.moveFlow(1L, "_flows/example/flow.yaml", "_flows/taken/flow.yaml"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("已存在");
        assertThat(repo.resolve("_flows/example/flow.yaml")).isRegularFile();
    }

    @ParameterizedTest
    @ValueSource(strings = {"中文任务", "task with spaces", " 中文 任务 ", "literal$1.name"})
    void renameAsSameDirectoryMovePreservesNames(String newName) throws Exception {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        OfflineFlowContentService service = new OfflineFlowContentService(
                properties, new RepoLockManager(), new OfflineKestraFlowFileService(properties));
        Path repo = properties.resolveRepoPath(1L);
        Path flowDir = repo.resolve("_flows/example");
        Path scriptsDir = repo.resolve("scripts/example");
        Files.createDirectories(flowDir);
        Files.createDirectories(scriptsDir);
        Files.writeString(flowDir.resolve("flow.yaml"), "script: scripts/example/node.sh\n");
        Files.writeString(scriptsDir.resolve("node.sh"), "echo 1\n");

        service.moveFlow(1L, "_flows/example/flow.yaml", "_flows/" + newName + "/flow.yaml");

        assertThat(flowDir).doesNotExist();
        assertThat(scriptsDir).doesNotExist();
        assertThat(Files.readString(repo.resolve("_flows").resolve(newName).resolve("flow.yaml")))
                .isEqualTo("script: scripts/" + newName + "/node.sh\n");
        assertThat(Files.readString(repo.resolve("scripts").resolve(newName).resolve("node.sh")))
                .isEqualTo("echo 1\n");
    }

    @Test
    void moveNestedFlowAcrossDirectoriesMovesHierarchicalScriptsMirror() throws Exception {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        OfflineFlowContentService service = new OfflineFlowContentService(
                properties, new RepoLockManager(), new OfflineKestraFlowFileService(properties));
        Path repo = properties.resolveRepoPath(1L);
        Path flowDir = repo.resolve("_flows/x/example");
        Path scriptsDir = repo.resolve("scripts/x/example");
        Files.createDirectories(flowDir);
        Files.createDirectories(scriptsDir);
        Files.writeString(flowDir.resolve("flow.yaml"), "script: scripts/x/example/node.sh\n");
        Files.writeString(scriptsDir.resolve("node.sh"), "echo 1\n");

        service.moveFlow(1L, "_flows/x/example/flow.yaml", "_flows/y/renamed/flow.yaml");

        assertThat(flowDir).doesNotExist();
        assertThat(scriptsDir).doesNotExist();
        assertThat(Files.readString(repo.resolve("_flows/y/renamed/flow.yaml")))
                .isEqualTo("script: scripts/y/renamed/node.sh\n");
        assertThat(Files.readString(repo.resolve("scripts/y/renamed/node.sh")))
                .isEqualTo("echo 1\n");
    }

    @Test
    void moveRefreshesPublishedKestraMirror() throws Exception {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        OfflineKestraFlowFileService kestraFlowFileService = new OfflineKestraFlowFileService(properties);
        OfflineFlowContentService service = new OfflineFlowContentService(
                properties, new RepoLockManager(), kestraFlowFileService);
        Path repo = properties.resolveRepoPath(1L);
        Path flowDir = repo.resolve("_flows/example");
        Files.createDirectories(flowDir);
        Files.writeString(flowDir.resolve("flow.yaml"), "id: example\ntasks: []\n");
        kestraFlowFileService.syncFlowFile(repo, "_flows/example/flow.yaml");

        service.moveFlow(1L, "_flows/example/flow.yaml", "_flows/renamed/flow.yaml");

        assertThat(kestraFlowFileService.resolveFlowFile(repo, "_flows/example/flow.yaml"))
                .doesNotExist();
        assertThat(kestraFlowFileService.resolveFlowFile(repo, "_flows/renamed/flow.yaml"))
                .isRegularFile();
    }

    @ParameterizedTest
    @ValueSource(strings = {"missing", "directory", "file"})
    void moveRejectsMissingOrWrongSourceTypeEvenForNoOp(String type) throws Exception {
        OfflineProperties properties = properties();
        Path repo = properties.resolveRepoPath(1L);
        Path source = repo.resolve("_flows/example");
        Files.createDirectories(source.getParent());
        if ("file".equals(type)) {
            Files.writeString(source, "not a directory");
        } else if ("directory".equals(type)) {
            Files.createDirectories(source.resolve("flow.yaml"));
        }
        Map<String, String> before = files();
        OfflineFlowContentService service = contentService(properties);

        assertThatThrownBy(() -> service.moveFlow(1L, "_flows/example/flow.yaml", "_flows/example/flow.yaml"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.moveFlow(1L, "_flows/example/flow.yaml", "_flows/new/flow.yaml"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(files()).isEqualTo(before);
        assertThat(repo.resolve("_flows/new")).doesNotExist();
    }

    @ParameterizedTest
    @ValueSource(strings = {"_flows/tmp/../example/flow.yaml", "_flows/./example/flow.yaml"})
    void moveRejectsUnnormalizedSource(String source) throws Exception {
        OfflineProperties properties = properties();
        seedFlow(properties);
        Map<String, String> before = files();

        assertThatThrownBy(() -> contentService(properties).moveFlow(1L, source, "_flows/new/flow.yaml"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(files()).isEqualTo(before);
    }

    @ParameterizedTest
    @ValueSource(strings = {"_flows/taken", "_flows/taken/deeper"})
    void moveRejectsTaskAnywhereInDestinationParents(String parent) throws Exception {
        OfflineProperties properties = properties();
        Path repo = seedFlow(properties);
        Files.createDirectories(repo.resolve("_flows/taken"));
        Files.writeString(repo.resolve("_flows/taken/flow.yaml"), "id: taken\n");
        Map<String, String> before = files();

        assertThatThrownBy(() -> contentService(properties).moveFlow(
                1L, "_flows/example/flow.yaml", parent + "/new/flow.yaml"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(files()).isEqualTo(before);
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void moveRejectsScriptsConflictEvenWithoutSourceScripts(boolean hasSourceScripts) throws Exception {
        OfflineProperties properties = properties();
        Path repo = seedFlow(properties);
        if (!hasSourceScripts) {
            Files.delete(repo.resolve("scripts/example/nested/node.sh"));
            Files.delete(repo.resolve("scripts/example/nested"));
            Files.delete(repo.resolve("scripts/example"));
        }
        Files.createDirectories(repo.resolve("scripts/y/new"));
        Files.writeString(repo.resolve("scripts/y/new/keep.sh"), "keep");
        Map<String, String> before = files();

        assertThatThrownBy(() -> contentService(properties).moveFlow(
                1L, "_flows/example/flow.yaml", "_flows/y/new/flow.yaml"))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("scripts");
        assertThat(files()).isEqualTo(before);
        assertThat(repo.resolve("_flows/y")).doesNotExist();
    }

    @ParameterizedTest
    @ValueSource(strings = {"_flows/example/linked", "scripts/example/linked", "_flows/y",
            "scripts/y", ".wb-data/kestra-flows/new.yaml", "transfers", "transfers/example",
            "transfers/example/nested/linked", "transfers/example/node.transfer.json",
            "transfers/new", "transfers/new/nested/linked"})
    void moveRejectsSymlinksWithoutTouchingTheirTargets(String linkPath) throws Exception {
        OfflineProperties properties = properties();
        Path repo = seedFlow(properties);
        Path outside = tempDir.resolve("outside");
        Files.createDirectories(outside);
        Files.writeString(outside.resolve("keep.txt"), "untouched");
        Path link = repo.resolve(linkPath);
        Files.createDirectories(link.getParent());
        Files.createSymbolicLink(link, outside);
        Map<String, String> before = files();

        assertThatThrownBy(() -> contentService(properties).moveFlow(
                1L, "_flows/example/flow.yaml", "_flows/y/new/flow.yaml"))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("符号链接");
        assertThat(files()).isEqualTo(before);
        assertThat(Files.isSymbolicLink(link)).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {"_flows/example", "_flows/example/flow.yaml", "scripts/example"})
    void moveRejectsSymlinkedSourcePaths(String linkPath) throws Exception {
        OfflineProperties properties = properties();
        Path repo = seedFlow(properties);
        Path link = repo.resolve(linkPath);
        Path outside = tempDir.resolve("original-source");
        Files.move(link, outside);
        Files.createSymbolicLink(link, outside);
        Map<String, String> before = files();

        assertThatThrownBy(() -> contentService(properties).moveFlow(
                1L, "_flows/example/flow.yaml", "_flows/y/new/flow.yaml"))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("符号链接");
        assertThat(files()).isEqualTo(before);
        assertThat(Files.isSymbolicLink(link)).isTrue();
    }

    @Test
    void moveRejectsAbsoluteSourceAndInRepoAbsoluteDestination() throws Exception {
        OfflineProperties properties = properties();
        Path repo = seedFlow(properties);
        Map<String, String> before = files();

        assertThatThrownBy(() -> contentService(properties).moveFlow(
                1L, repo.resolve("_flows/example/flow.yaml").toString(), "_flows/new/flow.yaml"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> contentService(properties).moveFlow(
                1L, "_flows/example/flow.yaml", repo.resolve("_flows/new/flow.yaml").toString()))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(files()).isEqualTo(before);
    }

    @Test
    void renameRejectsAnExistingOrphanMirrorInsteadOfOverwritingIt() throws Exception {
        OfflineProperties properties = properties();
        Path repo = seedFlow(properties);
        Path orphanMirror = repo.resolve(".wb-data/kestra-flows/new.yaml");
        Files.createDirectories(orphanMirror.getParent());
        Files.writeString(orphanMirror, "id: do-not-overwrite\n");
        Map<String, String> before = files();

        assertThatThrownBy(() -> contentService(properties).moveFlow(
                1L, "_flows/example/flow.yaml", "_flows/new/flow.yaml"))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("mirror");
        assertThat(files()).isEqualTo(before);
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void renameRejectsOtherTaskMirrorIdentityEvenIfNotYetPublished(boolean published) throws Exception {
        OfflineProperties properties = properties();
        Path repo = seedFlow(properties);
        Files.createDirectories(repo.resolve("_flows/other/new"));
        Files.writeString(repo.resolve("_flows/other/new/flow.yaml"), "id: other-id\nnamespace: other\n");
        if (published) {
            new OfflineKestraFlowFileService(properties).syncFlowFile(repo, "_flows/other/new/flow.yaml");
        }
        Map<String, String> before = files();

        assertThatThrownBy(() -> contentService(properties).moveFlow(
                1L, "_flows/example/flow.yaml", "_flows/y/new/flow.yaml"))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("mirror");
        assertThat(files()).isEqualTo(before);
    }

    @Test
    void moveRollsBackFlowDirectoryWhenScriptsMoveFails() throws Exception {
        OfflineProperties properties = properties();
        Path repo = seedFlow(properties);
        Map<String, String> before = files();
        Path oldScripts = repo.resolve("scripts/example");
        Path newScripts = repo.resolve("scripts/y/new");
        try (var mockedFiles = mockStatic(Files.class, invocation -> {
            if ("move".equals(invocation.getMethod().getName())
                    && oldScripts.equals(invocation.getArgument(0)) && newScripts.equals(invocation.getArgument(1))) {
                throw new IOException("scripts move failed");
            }
            return invocation.callRealMethod();
        })) {
            assertThatThrownBy(() -> contentService(properties).moveFlow(
                    1L, "_flows/example/flow.yaml", "_flows/y/new/flow.yaml"))
                    .isInstanceOf(IllegalStateException.class).hasRootCauseMessage("scripts move failed");
        }
        assertThat(files()).isEqualTo(before);
        assertThat(repo.resolve("_flows/y")).doesNotExist();
        assertThat(repo.resolve("scripts/y")).doesNotExist();
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void moveRollsBackScriptsYamlAndMirrorsWhenSyncFails(boolean runtimeFailure) throws Exception {
        OfflineProperties properties = properties();
        Path repo = seedFlow(properties);
        seedTransfers(repo);
        Files.writeString(repo.resolve("_flows/example/flow.yaml"), transferYaml());
        new OfflineKestraFlowFileService(properties).syncFlowFile(repo, "_flows/example/flow.yaml");
        Map<String, String> before = files();
        OfflineKestraFlowFileService failingMirror = new OfflineKestraFlowFileService(properties) {
            @Override
            public void syncFlowFile(Path repoPath, String flowPath) throws IOException {
                super.syncFlowFile(repoPath, flowPath);
                if (runtimeFailure) {
                    throw new IllegalStateException("mirror failed");
                }
                throw new IOException("mirror failed");
            }
        };
        OfflineFlowContentService service = new OfflineFlowContentService(properties, new RepoLockManager(), failingMirror);

        assertThatThrownBy(() -> service.moveFlow(1L, "_flows/example/flow.yaml", "_flows/y/new/flow.yaml"))
                .isInstanceOf(IllegalStateException.class);
        assertThat(files()).isEqualTo(before);
        assertThat(repo.resolve("_flows/y")).doesNotExist();
        assertThat(repo.resolve("scripts/y")).doesNotExist();
    }

    @Test
    void renameRollsBackNewMirrorAndContentsIfOldMirrorDeletionFails() throws Exception {
        OfflineProperties properties = properties();
        Path repo = seedFlow(properties);
        OfflineKestraFlowFileService mirrors = new OfflineKestraFlowFileService(properties);
        mirrors.syncFlowFile(repo, "_flows/example/flow.yaml");
        Path oldMirror = mirrors.resolveFlowFile(repo, "_flows/example/flow.yaml");
        Map<String, String> before = files();
        try (var mockedFiles = mockStatic(Files.class, invocation -> {
            if ("deleteIfExists".equals(invocation.getMethod().getName()) && oldMirror.equals(invocation.getArgument(0))) {
                throw new IOException("mirror delete failed");
            }
            return invocation.callRealMethod();
        })) {
            assertThatThrownBy(() -> contentService(properties).moveFlow(
                    1L, "_flows/example/flow.yaml", "_flows/y/new/flow.yaml"))
                    .isInstanceOf(IllegalStateException.class).hasRootCauseMessage("mirror delete failed");
        }
        assertThat(files()).isEqualTo(before);
        assertThat(repo.resolve("_flows/y")).doesNotExist();
        assertThat(repo.resolve("scripts/y")).doesNotExist();
    }

    @Test
    void nestedRenamePreservesIdentityAndDeleteUsesHierarchicalScripts() throws Exception {
        OfflineProperties properties = properties();
        Path repo = seedFlow(properties);
        OfflineFlowContentService service = contentService(properties);
        OfflineKestraFlowFileService mirrors = new OfflineKestraFlowFileService(properties);
        mirrors.syncFlowFile(repo, "_flows/example/flow.yaml");
        Files.createDirectories(repo.resolve("scripts/new"));
        Files.writeString(repo.resolve("scripts/new/unrelated.sh"), "keep");

        service.moveFlow(1L, "_flows/example/flow.yaml", "_flows/y/new/flow.yaml");

        String expected = "id: stable-id\nnamespace: stable.namespace\nscript: scripts/y/new/nested/node.sh\n";
        assertThat(Files.readString(repo.resolve("_flows/y/new/flow.yaml"))).isEqualTo(expected);
        assertThat(Files.readString(mirrors.resolveFlowFile(repo, "_flows/y/new/flow.yaml"))).isEqualTo(expected);
        assertThat(mirrors.resolveFlowFile(repo, "_flows/example/flow.yaml")).doesNotExist();
        assertThat(Files.readString(repo.resolve("scripts/y/new/nested/node.sh"))).isEqualTo("echo 1\n");
        assertThat(Files.readString(repo.resolve("_flows/y/new/.parameters.json"))).isEqualTo("{\"schemaVersion\":1}\n");

        service.deleteFlow(1L, "_flows/y/new/flow.yaml");

        assertThat(repo.resolve("_flows/y/new")).doesNotExist();
        assertThat(repo.resolve("scripts/y/new")).doesNotExist();
        assertThat(mirrors.resolveFlowFile(repo, "_flows/y/new/flow.yaml")).doesNotExist();
        assertThat(Files.readString(repo.resolve("scripts/new/unrelated.sh"))).isEqualTo("keep");
    }

    @Test
    void sameBasenameMoveKeepsTransferDirectoryButUpdatesEveryConfigFlowPath() throws Exception {
        OfflineProperties properties = properties();
        Path repo = seedFlow(properties);
        seedTransfers(repo);
        Files.writeString(repo.resolve("_flows/example/flow.yaml"), transferYaml());

        contentService(properties).moveFlow(1L, "_flows/example/flow.yaml", "_flows/y/example/flow.yaml");

        assertTransfers(repo, "example", "_flows/y/example/flow.yaml");
        assertThat(repo.resolve("transfers/y")).doesNotExist();
        String expected = transferYaml().replace("scripts/example/", "scripts/y/example/");
        assertThat(Files.readString(repo.resolve("_flows/y/example/flow.yaml"))).isEqualTo(expected);
        assertThat(Files.readString(repo.resolve(".wb-data/kestra-flows/example.yaml"))).isEqualTo(expected);
    }

    @ParameterizedTest
    @ValueSource(strings = {"new", "literal$1.name"})
    void renameMovesWholeTransferDirectoryAndRewritesMetadataNamespaceFilesAndCommands(String newName) throws Exception {
        OfflineProperties properties = properties();
        Path repo = seedFlow(properties);
        seedTransfers(repo);
        Files.writeString(repo.resolve("_flows/example/flow.yaml"), transferYaml());
        Files.createDirectories(repo.resolve("transfers/example/empty"));
        Path attachment = repo.resolve("transfers/example/nested/keep.txt");
        Files.writeString(attachment, "transfers/example/ must not be rewritten in unrelated files");
        FileTime attachmentTime = Files.getLastModifiedTime(attachment);
        new OfflineKestraFlowFileService(properties).syncFlowFile(repo, "_flows/example/flow.yaml");

        contentService(properties).moveFlow(1L, "_flows/example/flow.yaml", "_flows/y/" + newName + "/flow.yaml");

        assertThat(repo.resolve("transfers/example")).doesNotExist();
        assertTransfers(repo, newName, "_flows/y/" + newName + "/flow.yaml");
        assertThat(repo.resolve("transfers/" + newName + "/empty")).isDirectory();
        Path movedAttachment = repo.resolve("transfers/" + newName + "/nested/keep.txt");
        assertThat(Files.readString(movedAttachment)).isEqualTo("transfers/example/ must not be rewritten in unrelated files");
        assertThat(Files.getLastModifiedTime(movedAttachment)).isEqualTo(attachmentTime);
        String expected = transferYaml().replace("scripts/example/", "scripts/y/" + newName + "/")
                .replace("transfers/example/", "transfers/" + newName + "/");
        assertThat(Files.readString(repo.resolve("_flows/y/" + newName + "/flow.yaml"))).isEqualTo(expected);
        assertThat(Files.readString(repo.resolve(".wb-data/kestra-flows/" + newName + ".yaml"))).isEqualTo(expected);
        assertThat(repo.resolve(".wb-data/kestra-flows/example.yaml")).doesNotExist();
    }

    @Test
    void reusingOldBasenameAfterRenameCannotOverwriteTheMovedFlowsTransferConfig() throws Exception {
        OfflineProperties properties = properties();
        Path repo = seedFlow(properties);
        seedTransfers(repo);
        Files.writeString(repo.resolve("_flows/example/flow.yaml"), transferYaml());
        OfflineFlowContentService service = contentService(properties);
        service.moveFlow(1L, "_flows/example/flow.yaml", "_flows/new/flow.yaml");
        Map<String, String> moved = files();
        TransferConfigFileService configs = new TransferConfigFileService(new ObjectMapper()
                .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES));

        seedFlow(properties);
        String reusedPath = configs.write(repo, 1L, "_flows/example/flow.yaml", "node",
                configs.read(repo, "transfers/new/node.transfer.json"));

        assertThat(reusedPath).isEqualTo("transfers/example/node.transfer.json");
        assertThat(Files.readString(repo.resolve("_flows/new/flow.yaml")))
                .doesNotContain("transfers/example/").contains("transfers/new/node.transfer.json");
        assertThat(Files.readString(repo.resolve(".wb-data/kestra-flows/new.yaml")))
                .doesNotContain("transfers/example/").contains("transfers/new/node.transfer.json");
        assertTransfers(repo, "new", "_flows/new/flow.yaml");
        assertThat(files()).containsAllEntriesOf(moved);
        assertThat(new ObjectMapper().readTree(Files.readString(repo.resolve(reusedPath))).path("flowPath").asText())
                .isEqualTo("_flows/example/flow.yaml");
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void renameRejectsExistingTransferDirectoryEvenWithoutSourceTransfers(boolean hasSource) throws Exception {
        OfflineProperties properties = properties();
        Path repo = seedFlow(properties);
        if (hasSource) {
            seedTransfers(repo);
        }
        Files.createDirectories(repo.resolve("transfers/new"));
        Files.writeString(repo.resolve("transfers/new/keep.transfer.json"), "{\"flowPath\":\"_flows/other/new/flow.yaml\"}");
        Map<String, String> before = files();

        assertThatThrownBy(() -> contentService(properties).moveFlow(
                1L, "_flows/example/flow.yaml", "_flows/y/new/flow.yaml"))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("transfers");
        assertThat(files()).isEqualTo(before);
    }

    @ParameterizedTest
    @ValueSource(strings = {"transfers", "transfers/example", "transfers/new"})
    void moveRejectsTransferPathsThatAreNotDirectories(String path) throws Exception {
        OfflineProperties properties = properties();
        Path repo = seedFlow(properties);
        Path invalid = repo.resolve(path);
        Files.createDirectories(invalid.getParent());
        Files.writeString(invalid, "not a directory");
        Map<String, String> before = files();

        assertThatThrownBy(() -> contentService(properties).moveFlow(
                1L, "_flows/example/flow.yaml", "_flows/y/new/flow.yaml"))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("目录");
        assertThat(files()).isEqualTo(before);
    }

    @ParameterizedTest
    @ValueSource(strings = {"null", "[]", "42", "\"text\"", "{}", "{\"flowPath\":null}",
            "{\"flowPath\":42}", "{\"flowPath\":[]}", "{\"flowPath\":{}}", "{\"flowPath\":\"\"}",
            "{\"flowPath\":\"_flows/other/example/flow.yaml\"}", "{\"flowPath\":\"_flows/y/new/flow.yaml\"}",
            "{\"flowPath\":\"_flows/./example/flow.yaml\"}"})
    void moveRejectsInvalidTransferJsonTypesAndOwnershipBeforeAnyMutation(String json) throws Exception {
        OfflineProperties properties = properties();
        Path repo = seedFlow(properties);
        seedTransfers(repo);
        Files.writeString(repo.resolve("transfers/example/z-invalid.transfer.json"), json);
        Map<String, String> before = files();

        assertThatThrownBy(() -> contentService(properties).moveFlow(
                1L, "_flows/example/flow.yaml", "_flows/y/new/flow.yaml"))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("flowPath");
        assertThat(files()).isEqualTo(before);
    }

    @ParameterizedTest
    @ValueSource(strings = {"{", "{\"flowPath\":\"_flows/example/flow.yaml\"} {}"})
    void moveParsesAllTransferJsonBeforeAnyMutation(String malformed) throws Exception {
        OfflineProperties properties = properties();
        Path repo = seedFlow(properties);
        seedTransfers(repo);
        Files.writeString(repo.resolve("transfers/example/z-invalid.transfer.json"), malformed);
        Map<String, String> before = files();

        assertThatThrownBy(() -> contentService(properties).moveFlow(
                1L, "_flows/example/flow.yaml", "_flows/y/new/flow.yaml"))
                .isInstanceOf(IllegalStateException.class);
        assertThat(files()).isEqualTo(before);
    }

    private String transferYaml() {
        return """
                id: stable-id
                namespace: stable.namespace
                script: scripts/example/nested/node.sh
                tasks:
                  - id: node
                    description: '[wbdata-meta] nodeKind=TRANSFER;transferConfigPath=transfers/example/node.transfer.json'
                    namespaceFiles:
                      enabled: true
                      include:
                        - transfers/example/node.transfer.json
                        - transfers/example/nested/second.transfer.json
                    commands:
                      - "cat 'transfers/example/node.transfer.json'; cat 'transfers/example/nested/second.transfer.json'"
                      - "curl --data-binary @'transfers/example/node.transfer.json'"
                """;
    }

    private ObjectNode transferJson() throws IOException {
        return (ObjectNode) new ObjectMapper().readTree("""
                {
                  "schemaVersion": 1, "groupId": 1, "flowPath": "_flows/example/flow.yaml", "taskId": "node",
                  "source": {"dataSourceId": 1, "dataSourceType": "MYSQL", "database": "db", "table": "source"},
                  "target": {"dataSourceId": 2, "dataSourceType": "MYSQL", "database": "db", "table": "target", "writeMode": "append"},
                  "writeMode": "append", "fieldMappings": [], "partitions": [],
                  "extra": {"flowPath": "_flows/example/flow.yaml", "text": "transfers/example/node.transfer.json", "flags": [true, null, 7]}
                }
                """);
    }

    private void seedTransfers(Path repo) throws IOException {
        for (String name : new String[]{"node.transfer.json", "nested/second.transfer.json"}) {
            Path file = repo.resolve("transfers/example/" + name);
            Files.createDirectories(file.getParent());
            Files.writeString(file, transferJson().toPrettyString());
            Files.setLastModifiedTime(file, FileTime.fromMillis(1_600_000_000_000L));
        }
    }

    private void assertTransfers(Path repo, String basename, String flowPath) throws IOException {
        ObjectNode expected = transferJson().put("flowPath", flowPath);
        for (String name : new String[]{"node.transfer.json", "nested/second.transfer.json"}) {
            assertThat(new ObjectMapper().readTree(Files.readString(repo.resolve("transfers/" + basename + "/" + name))))
                    .isEqualTo(expected);
        }
    }

    private OfflineProperties properties() {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        return properties;
    }

    private OfflineFlowContentService contentService(OfflineProperties properties) {
        return new OfflineFlowContentService(properties, new RepoLockManager(), new OfflineKestraFlowFileService(properties));
    }

    private Path seedFlow(OfflineProperties properties) throws IOException {
        Path repo = properties.resolveRepoPath(1L);
        Files.createDirectories(repo.resolve("_flows/example"));
        Files.writeString(repo.resolve("_flows/example/flow.yaml"),
                "id: stable-id\nnamespace: stable.namespace\nscript: scripts/example/nested/node.sh\n");
        Files.writeString(repo.resolve("_flows/example/.parameters.json"), "{\"schemaVersion\":1}\n");
        Files.createDirectories(repo.resolve("scripts/example/nested"));
        Files.writeString(repo.resolve("scripts/example/nested/node.sh"), "echo 1\n");
        return repo;
    }

    private Map<String, String> files() throws IOException {
        Map<String, String> result = new TreeMap<>();
        try (var paths = Files.walk(tempDir)) {
            for (Path path : paths.toList()) {
                String content;
                if (Files.isSymbolicLink(path)) {
                    content = "link: " + Files.readSymbolicLink(path);
                } else if (Files.isRegularFile(path)) {
                    content = Files.getLastModifiedTime(path) + "\n" + Files.readString(path);
                } else {
                    content = "directory";
                }
                result.put(tempDir.relativize(path).toString(), content);
            }
        }
        return result;
    }

    @Test
    void moveAndDeleteFlowCarryParameterSnapshotWithFlowDirectory() throws Exception {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        RepoLockManager lockManager = new RepoLockManager();
        OfflineFlowContentService service = new OfflineFlowContentService(
                properties,
                lockManager,
                new OfflineKestraFlowFileService(properties)
        );
        Path repo = properties.resolveRepoPath(1L);
        Path flowDir = repo.resolve("_flows/example");
        Files.createDirectories(flowDir);
        Files.writeString(flowDir.resolve("flow.yaml"), "id: example\ntasks: []\n");
        Files.writeString(flowDir.resolve(".parameters.json"), "{\"schemaVersion\":1}\n");

        service.moveFlow(1L, "_flows/example/flow.yaml", "_flows/renamed/flow.yaml");

        assertThat(repo.resolve("_flows/example/.parameters.json")).doesNotExist();
        assertThat(repo.resolve("_flows/renamed/.parameters.json")).isRegularFile();

        service.deleteFlow(1L, "_flows/renamed/flow.yaml");

        assertThat(repo.resolve("_flows/renamed")).doesNotExist();
    }

    @Test
    void deleteFlowRemovesPublishedKestraMirror() throws Exception {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        RepoLockManager lockManager = new RepoLockManager();
        OfflineKestraFlowFileService kestraFlowFileService = new OfflineKestraFlowFileService(properties);
        OfflineFlowContentService service = new OfflineFlowContentService(
                properties,
                lockManager,
                kestraFlowFileService
        );
        Path repo = properties.resolveRepoPath(1L);
        Path flow = repo.resolve("_flows/example/flow.yaml");
        Files.createDirectories(flow.getParent());
        Files.writeString(flow, "id: example\ntasks: []\n");
        kestraFlowFileService.syncFlowFile(repo, "_flows/example/flow.yaml");

        service.deleteFlow(1L, "_flows/example/flow.yaml");

        assertThat(kestraFlowFileService.resolveFlowFile(repo, "_flows/example/flow.yaml"))
                .doesNotExist();
    }
}
