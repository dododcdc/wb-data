package com.wbdata.offline.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.wbdata.offline.config.OfflineProperties;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.util.Map;
import java.util.TreeMap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class OfflineRepoTreeServiceTest {
    @TempDir
    Path tempDir;

    private OfflineRepoTreeService service() {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        return new OfflineRepoTreeService(properties, new RepoLockManager(), new OfflineKestraFlowFileService(properties));
    }

    private Path repo() {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        return properties.resolveRepoPath(1L);
    }

    @Test
    void moveFolderAcrossDirectoriesMovesScriptsMirrorAndRewritesReferences() throws Exception {
        Path repo = repo();
        Files.createDirectories(repo.resolve("_flows/x/nested/task-a"));
        Files.writeString(repo.resolve("_flows/x/nested/task-a/flow.yaml"),
                "script: scripts/x/nested/task-a/node.sh\n");
        Files.createDirectories(repo.resolve("scripts/x/nested/task-a"));
        Files.writeString(repo.resolve("scripts/x/nested/task-a/node.sh"), "echo 1\n");

        service().moveFolder(1L, "_flows/x/nested", "_flows/y/moved");

        assertThat(repo.resolve("_flows/x/nested")).doesNotExist();
        assertThat(repo.resolve("scripts/x/nested")).doesNotExist();
        assertThat(Files.readString(repo.resolve("_flows/y/moved/task-a/flow.yaml")))
                .isEqualTo("script: scripts/y/moved/task-a/node.sh\n");
        assertThat(Files.readString(repo.resolve("scripts/y/moved/task-a/node.sh")))
                .isEqualTo("echo 1\n");
    }

    @Test
    void renameAsSameDirectoryMoveStillWorks() throws Exception {
        Path repo = repo();
        Files.createDirectories(repo.resolve("_flows/jack/task-a"));
        Files.writeString(repo.resolve("_flows/jack/task-a/flow.yaml"),
                "script: scripts/jack/task-a/node.sh\n");
        Files.createDirectories(repo.resolve("scripts/jack/task-a"));
        Files.writeString(repo.resolve("scripts/jack/task-a/node.sh"), "echo 1\n");

        service().moveFolder(1L, "_flows/jack", "_flows/jack-renamed");

        assertThat(repo.resolve("_flows/jack")).doesNotExist();
        assertThat(Files.readString(repo.resolve("_flows/jack-renamed/task-a/flow.yaml")))
                .isEqualTo("script: scripts/jack-renamed/task-a/node.sh\n");
        assertThat(repo.resolve("scripts/jack-renamed/task-a/node.sh")).isRegularFile();
    }

    @Test
    void moveFolderRejectsMovingIntoOwnSubtree() throws Exception {
        Path repo = repo();
        Files.createDirectories(repo.resolve("_flows/x/sub"));

        assertThatThrownBy(() -> service().moveFolder(1L, "_flows/x", "_flows/x/sub/deeper"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("自身子目录");
        assertThat(repo.resolve("_flows/x/sub")).isDirectory();
    }

    @Test
    void moveFolderRejectsExistingDestination() throws Exception {
        Path repo = repo();
        Files.createDirectories(repo.resolve("_flows/x"));
        Files.createDirectories(repo.resolve("_flows/y/x"));

        assertThatThrownBy(() -> service().moveFolder(1L, "_flows/x", "_flows/y/x"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("已存在");
        assertThat(repo.resolve("_flows/x")).isDirectory();
    }

    @ParameterizedTest
    @ValueSource(strings = {"_flows", "scripts/x", "../outside", "_flows/bad\\name",
            "_flows/unused/../new", "_flows/./new", "", " "})
    void moveFolderRejectsIllegalDestination(String newPath) throws Exception {
        Path repo = repo();
        Files.createDirectories(repo.resolve("_flows/x"));

        assertThatThrownBy(() -> service().moveFolder(1L, "_flows/x", newPath))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(repo.resolve("_flows/x")).isDirectory();
    }

    @Test
    void moveFolderRejectsSourceOutsideFlows() throws Exception {
        Path repo = repo();
        Files.createDirectories(repo.resolve("scripts/x"));

        assertThatThrownBy(() -> service().moveFolder(1L, "scripts/x", "_flows/x"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("_flows");
        assertThat(repo.resolve("scripts/x")).isDirectory();
    }

    @ParameterizedTest
    @ValueSource(strings = {"missing", "file", "flow"})
    void folderApiRejectsMissingSourcesFilesAndFlowsIncludingNoOp(String kind) throws Exception {
        Path source = repo().resolve("_flows/source");
        Files.createDirectories(source.getParent());
        if ("file".equals(kind)) {
            Files.writeString(source, "not a directory");
        } else if ("flow".equals(kind)) {
            Files.createDirectories(source.resolve("extra"));
            Files.writeString(source.resolve("flow.yaml"), "id: source\n");
        }
        Map<String, String> before = snapshot();

        assertThatThrownBy(() -> service().moveFolder(1L, "_flows/source", "_flows/destination"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service().moveFolder(1L, "_flows/source", "_flows/source"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(snapshot()).isEqualTo(before);
    }

    @Test
    void folderMoveRejectsAbsoluteAndUnnormalizedSourcesAndAbsoluteDestination() throws Exception {
        seedFolder();
        Map<String, String> before = snapshot();

        for (String source : new String[]{repo().resolve("_flows/source").toString(),
                "_flows/unused/../source", "_flows/./source"}) {
            assertThatThrownBy(() -> service().moveFolder(1L, source, "_flows/destination"))
                    .isInstanceOf(IllegalArgumentException.class);
        }
        assertThatThrownBy(() -> service().moveFolder(
                1L, "_flows/source", repo().resolve("_flows/destination").toString()))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(snapshot()).isEqualTo(before);
    }

    @ParameterizedTest
    @ValueSource(strings = {"task-parent", "scripts-conflict", "scripts-file", "parent-file", "mirror-directory"})
    void folderMovePreflightsAllDestinationsBeforeMovingSource(String problem) throws Exception {
        seedFolder();
        Path repo = repo();
        switch (problem) {
            case "task-parent" -> {
                Files.createDirectories(repo.resolve("_flows/destination"));
                Files.writeString(repo.resolve("_flows/destination/flow.yaml"), "id: destination\n");
            }
            case "scripts-conflict" -> {
                Files.createDirectories(repo.resolve("scripts/destination/deeper/moved"));
                Files.writeString(repo.resolve("scripts/destination/deeper/moved/keep.sh"), "keep");
            }
            case "scripts-file" -> {
                Files.delete(repo.resolve("scripts/source/nested/task-b/deep/node.sh"));
                Files.delete(repo.resolve("scripts/source/nested/task-b/deep"));
                Files.delete(repo.resolve("scripts/source/nested/task-b"));
                Files.delete(repo.resolve("scripts/source/nested"));
                Files.delete(repo.resolve("scripts/source"));
                Files.writeString(repo.resolve("scripts/source"), "not a directory");
            }
            case "parent-file" -> Files.writeString(repo.resolve("_flows/destination"), "not a directory");
            case "mirror-directory" -> Files.createDirectories(repo.resolve(".wb-data/kestra-flows/task-b.yaml"));
            default -> throw new AssertionError(problem);
        }
        Map<String, String> before = snapshot();

        assertThatThrownBy(() -> service().moveFolder(1L, "_flows/source", "_flows/destination/deeper/moved"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(snapshot()).isEqualTo(before);
    }

    @ParameterizedTest
    @ValueSource(strings = {"_flows/source/linked", "scripts/source/linked", "_flows/destination",
            "scripts/destination", ".wb-data/kestra-flows/task-a.yaml", "transfers/task-a/linked",
            "transfers/task-b/deep/linked.transfer.json"})
    void folderMoveRejectsSymlinksInSourceDestinationScriptsAndMirrors(String linkPath) throws Exception {
        seedFolder();
        Path outside = tempDir.resolve("outside");
        Files.createDirectories(outside);
        Files.writeString(outside.resolve("keep.txt"), "keep");
        Path link = repo().resolve(linkPath);
        Files.createDirectories(link.getParent());
        Files.createSymbolicLink(link, outside);
        Map<String, String> before = snapshot();

        assertThatThrownBy(() -> service().moveFolder(1L, "_flows/source", "_flows/destination/moved"))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("符号链接");
        assertThat(snapshot()).isEqualTo(before);
        assertThat(Files.isSymbolicLink(link)).isTrue();
    }

    @Test
    void folderMoveRefreshesEveryDescendantMirrorWithoutChangingYamlIdentity() throws Exception {
        seedFolder();
        OfflineProperties properties = properties();
        OfflineKestraFlowFileService mirrors = new OfflineKestraFlowFileService(properties);
        mirrors.syncFlowFile(repo(), "_flows/source/task-a/flow.yaml");
        mirrors.syncFlowFile(repo(), "_flows/source/nested/task-b/flow.yaml");

        service().moveFolder(1L, "_flows/source", "_flows/destination/moved");

        for (String subPath : new String[]{"task-a", "nested/task-b"}) {
            String newPath = "_flows/destination/moved/" + subPath + "/flow.yaml";
            String expected = flowContent(subPath).replace("scripts/source/", "scripts/destination/moved/");
            assertThat(Files.readString(repo().resolve(newPath))).isEqualTo(expected);
            assertThat(Files.readString(mirrors.resolveFlowFile(repo(), newPath))).isEqualTo(expected);
            Path transfer = repo().resolve("transfers/" + Path.of(subPath).getFileName() + "/node.transfer.json");
            assertThat(new ObjectMapper().readTree(Files.readString(transfer)))
                    .isEqualTo(transferContent(subPath).put("flowPath", newPath));
        }
        assertThat(repo().resolve("transfers/destination")).doesNotExist();
        assertThat(Files.readString(repo().resolve("scripts/destination/moved/nested/task-b/deep/node.sh")))
                .isEqualTo("echo 1\n");
        assertThat(Files.readString(repo().resolve("_flows/destination/moved/task-a/.parameters.json")))
                .isEqualTo("{\"schemaVersion\":1}\n");
        assertThat(repo().resolve("_flows/source")).doesNotExist();
        assertThat(repo().resolve("scripts/source")).doesNotExist();
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void folderMoveRollsBackAllDescendantsAndMirrorsAfterLaterSyncFails(boolean published) throws Exception {
        seedFolder();
        OfflineProperties properties = properties();
        if (published) {
            OfflineKestraFlowFileService mirrors = new OfflineKestraFlowFileService(properties);
            mirrors.syncFlowFile(repo(), "_flows/source/task-a/flow.yaml");
            mirrors.syncFlowFile(repo(), "_flows/source/nested/task-b/flow.yaml");
        }
        Map<String, String> before = snapshot();
        OfflineKestraFlowFileService failingMirror = new OfflineKestraFlowFileService(properties) {
            private int syncCount;

            @Override
            public void syncFlowFile(Path repoPath, String flowPath) throws IOException {
                super.syncFlowFile(repoPath, flowPath);
                if (++syncCount == 2) {
                    throw new IOException("second mirror failed");
                }
            }
        };
        OfflineRepoTreeService service = new OfflineRepoTreeService(properties, new RepoLockManager(), failingMirror);

        assertThatThrownBy(() -> service.moveFolder(1L, "_flows/source", "_flows/destination/moved"))
                .isInstanceOf(IllegalStateException.class).hasRootCauseMessage("second mirror failed");
        assertThat(snapshot()).isEqualTo(before);
    }

    @Test
    void folderMoveRejectsAmbiguousDescendantMirrorOwnership() throws Exception {
        seedFolder();
        Files.createDirectories(repo().resolve("_flows/other/task-b"));
        Files.writeString(repo().resolve("_flows/other/task-b/flow.yaml"), "id: unrelated\n");
        Map<String, String> before = snapshot();

        assertThatThrownBy(() -> service().moveFolder(1L, "_flows/source", "_flows/destination"))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("mirror");
        assertThat(snapshot()).isEqualTo(before);
    }

    @ParameterizedTest
    @ValueSource(strings = {"ownership", "malformed", "directory", "file"})
    void folderMoveValidatesLastDescendantTransferBeforeChangingAnyEarlierDescendant(String problem) throws Exception {
        seedFolder();
        Path directory = repo().resolve("transfers/task-a");
        Path config = directory.resolve("node.transfer.json");
        switch (problem) {
            case "ownership" -> Files.writeString(config, "{\"flowPath\":\"_flows/other/task-a/flow.yaml\"}");
            case "malformed" -> Files.writeString(config, "{broken");
            case "directory" -> {
                Files.delete(config);
                Files.createDirectory(config);
            }
            case "file" -> {
                Files.delete(config);
                Files.delete(directory);
                Files.writeString(directory, "not a directory");
            }
            default -> throw new AssertionError(problem);
        }
        Map<String, String> before = snapshot();
        Class<? extends RuntimeException> expected = "malformed".equals(problem)
                ? IllegalStateException.class : IllegalArgumentException.class;

        assertThatThrownBy(() -> service().moveFolder(1L, "_flows/source", "_flows/destination/moved"))
                .isInstanceOf(expected);
        assertThat(snapshot()).isEqualTo(before);
    }

    private OfflineProperties properties() {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        return properties;
    }

    private void seedFolder() throws IOException {
        for (String subPath : new String[]{"task-a", "nested/task-b"}) {
            Path directory = repo().resolve("_flows/source/" + subPath);
            Files.createDirectories(directory);
            Files.writeString(directory.resolve("flow.yaml"), flowContent(subPath));
            Path transfer = repo().resolve("transfers/" + Path.of(subPath).getFileName() + "/node.transfer.json");
            Files.createDirectories(transfer.getParent());
            Files.writeString(transfer, transferContent(subPath).toPrettyString());
            Files.setLastModifiedTime(transfer, FileTime.fromMillis(1_600_000_000_000L));
        }
        Files.writeString(repo().resolve("_flows/source/task-a/.parameters.json"), "{\"schemaVersion\":1}\n");
        Files.createDirectories(repo().resolve("scripts/source/nested/task-b/deep"));
        Files.writeString(repo().resolve("scripts/source/nested/task-b/deep/node.sh"), "echo 1\n");
    }

    private String flowContent(String subPath) {
        return "id: stable-" + Path.of(subPath).getFileName() + "\nnamespace: stable.namespace\n"
                + "script: scripts/source/" + subPath + "/deep/node.sh\n"
                + "description: '[wbdata-meta] nodeKind=TRANSFER;transferConfigPath=transfers/"
                + Path.of(subPath).getFileName() + "/node.transfer.json'\n";
    }

    private ObjectNode transferContent(String subPath) {
        ObjectNode config = new ObjectMapper().createObjectNode();
        config.put("schemaVersion", 1);
        config.put("flowPath", "_flows/source/" + subPath + "/flow.yaml");
        config.put("taskId", "node");
        config.putObject("extra").put("flowPath", "_flows/source/" + subPath + "/flow.yaml");
        return config;
    }

    private Map<String, String> snapshot() throws IOException {
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
    void repoTreeFlowNodesCarryScheduleAndDependencyStatus() throws Exception {
        Path repo = repo();
        Files.createDirectories(repo.resolve("_flows/daily-task"));
        Files.writeString(repo.resolve("_flows/daily-task/flow.yaml"), """
                id: daily-task
                namespace: g1-main
                tasks: []
                labels:
                  wbdataDependencies: "1:upstream_a,1:upstream_b"
                triggers:
                  - id: schedule
                    type: io.kestra.plugin.core.trigger.Schedule
                    cron: "0 2 * * *"
                    timezone: Asia/Shanghai
                """);
        Files.createDirectories(repo.resolve("_flows/disabled-task"));
        Files.writeString(repo.resolve("_flows/disabled-task/flow.yaml"), """
                id: disabled-task
                namespace: g1-main
                tasks: []
                triggers:
                  - id: schedule
                    type: io.kestra.plugin.core.trigger.Schedule
                    cron: "0 3 * * 1"
                    timezone: Asia/Shanghai
                    disabled: true
                """);
        Files.createDirectories(repo.resolve("_flows/plain-task"));
        Files.writeString(repo.resolve("_flows/plain-task/flow.yaml"), "id: plain-task\nnamespace: g1-main\ntasks: []\n");

        var tree = service().getRepoTree(1L, "root");
        var nodes = tree.root().children().stream()
                .collect(java.util.stream.Collectors.toMap(n -> n.name(), n -> n));

        var daily = nodes.get("daily-task");
        assertThat(daily.scheduleState()).isEqualTo("ENABLED");
        assertThat(daily.schedulePeriod()).isEqualTo("DAILY");
        assertThat(daily.dependencyCount()).isEqualTo(2);

        var disabled = nodes.get("disabled-task");
        assertThat(disabled.scheduleState()).isEqualTo("DISABLED");
        assertThat(disabled.schedulePeriod()).isEqualTo("WEEKLY");
        assertThat(disabled.dependencyCount()).isZero();

        var plain = nodes.get("plain-task");
        assertThat(plain.scheduleState()).isEqualTo("NONE");
        assertThat(plain.schedulePeriod()).isNull();
        assertThat(plain.dependencyCount()).isZero();
    }

    @Test
    void repoTreeToleratesUnparseableFlowYaml() throws Exception {
        Path repo = repo();
        Files.createDirectories(repo.resolve("_flows/broken"));
        Files.writeString(repo.resolve("_flows/broken/flow.yaml"), "id: [unclosed\n  bad: {yaml");

        var tree = service().getRepoTree(1L, "root");

        assertThat(tree.root().children()).hasSize(1);
        var broken = tree.root().children().getFirst();
        assertThat(broken.kind()).isEqualTo("FLOW");
        assertThat(broken.scheduleState()).isEqualTo("NONE");
        assertThat(broken.dependencyCount()).isZero();
    }
}
