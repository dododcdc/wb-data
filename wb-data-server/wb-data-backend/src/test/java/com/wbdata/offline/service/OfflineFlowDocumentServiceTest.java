package com.wbdata.offline.service;

import com.wbdata.auth.context.GroupAuthContext;
import com.wbdata.auth.dto.ProjectGroupContextItem;
import com.wbdata.auth.service.AuthContextService;
import com.wbdata.auth.service.AuthSession;
import com.wbdata.datasource.service.DataSourceService;
import com.wbdata.offline.controller.OfflineFlowController;
import com.wbdata.offline.dto.OfflineFlowDependencyRef;
import com.wbdata.offline.dto.OfflineFlowDependencySettings;
import com.wbdata.offline.dto.OfflineFlowDocumentResponse;
import com.wbdata.offline.enums.OfflineCrossGroupDependency;
import com.wbdata.offline.enums.OfflineFailurePolicy;
import com.wbdata.datasource.entity.DataSource;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wbdata.offline.config.OfflineProperties;
import com.wbdata.offline.config.OfflineTransferProperties;
import com.wbdata.offline.dto.DebugDocumentExecutionRequest;
import com.wbdata.offline.dto.FlowParameterBindingRequest;
import com.wbdata.offline.dto.NodePosition;
import com.wbdata.offline.dto.OfflineFlowNodeResponse;
import com.wbdata.offline.dto.OfflineFlowSchedule;
import com.wbdata.offline.dto.SaveOfflineFlowDocumentRequest;
import com.wbdata.offline.dto.SaveOfflineFlowNodeRequest;
import com.wbdata.offline.dto.SaveOfflineFlowStageRequest;
import com.wbdata.offline.enums.OfflineSchedulePeriod;
import com.wbdata.offline.transfer.dto.TransferConfig;
import com.wbdata.offline.transfer.dto.TransferEndpointConfig;
import com.wbdata.offline.transfer.dto.TransferFieldMapping;
import com.wbdata.offline.transfer.dto.TransferMappingKind;
import com.wbdata.offline.transfer.dto.TransferWriteMode;
import com.wbdata.offline.transfer.service.TransferConfigFileService;
import com.wbdata.parameter.service.ParameterGroupService;
import com.wbdata.parameter.dto.ParameterDefinitionResponse;
import com.wbdata.parameter.dto.ParameterGroupResponse;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.web.server.ResponseStatusException;
import org.yaml.snakeyaml.Yaml;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class OfflineFlowDocumentServiceTest {

    @TempDir
    Path tempDir;

    @Test
    void documentEndpointCreatesScheduledDenyFlowAndIgnoresBodyGroup() {
        DocumentEndpointFixture fixture = new DocumentEndpointFixture();
        var settings = new OfflineFlowDependencySettings(List.of(), OfflineFailurePolicy.PAUSE, OfflineCrossGroupDependency.DENY);

        var saved = fixture.save(1L, "new_task", runtimeSchedule(), settings, 1L);

        assertThat(saved.groupId()).isEqualTo(1L);
        assertThat(saved.schedule()).isEqualTo(runtimeSchedule());
        assertThat(saved.dependencyConfig()).isEqualTo(settings);
        assertThat(fixture.properties.resolveRepoPath(999L)).doesNotExist();
        assertThat(fixture.documents.getFlowDocument(1L, saved.path()).dependencyConfig()).isEqualTo(settings);
    }

    @Test
    void documentEndpointSavesDependenciesAndCanvasTogetherAndPreservesOmittedSettings() {
        DocumentEndpointFixture fixture = new DocumentEndpointFixture();
        var upstream = fixture.save(1L, "upstream", runtimeSchedule(), null, 1L);
        assertThat(upstream.dependencyConfig()).isEqualTo(new OfflineFlowDependencySettings(
                List.of(), OfflineFailurePolicy.CONTINUE, OfflineCrossGroupDependency.ALLOW));
        var settings = new OfflineFlowDependencySettings(List.of(new OfflineFlowDependencyRef(1L, "upstream")),
                OfflineFailurePolicy.PAUSE, OfflineCrossGroupDependency.DENY);

        var saved = fixture.save(1L, "downstream", runtimeSchedule(), settings, 1L);
        var reopened = fixture.documents.getFlowDocument(1L, saved.path());
        assertThat(reopened.dependencyConfig()).isEqualTo(settings);
        assertThat(reopened.stages()).isEqualTo(saved.stages());
        assertThat(reopened.layout()).isEqualTo(saved.layout());
        assertThat(reopened.stages().getFirst().nodes().getFirst().scriptContent()).isEqualTo("echo 2");

        var unchanged = fixture.save(1L, "downstream", null, null, 1L);
        assertThat(unchanged.dependencyConfig()).isEqualTo(settings);
        assertThat(unchanged.schedule()).isEqualTo(runtimeSchedule());
        var cleared = fixture.save(1L, "downstream", null,
                new OfflineFlowDependencySettings(List.of(), null, null), 1L);
        assertThat(cleared.dependencyConfig().dependencies()).isEmpty();
    }

    @Test
    void documentEndpointRejectsBadDependenciesBeforeCreatingAnyFiles() throws Exception {
        DocumentEndpointFixture fixture = new DocumentEndpointFixture();
        var settings = new OfflineFlowDependencySettings(List.of(new OfflineFlowDependencyRef(1L, "missing")), null, null);
        var before = fixture.files();

        assertThatThrownBy(() -> fixture.save(1L, "bad", runtimeSchedule(), settings, 1L))
                .isInstanceOfSatisfying(ResponseStatusException.class, ex -> assertThat(ex.getStatusCode().value()).isEqualTo(422));

        assertThat(fixture.files()).isEqualTo(before);
        assertThat(fixture.properties.resolveRepoPath(1L)).doesNotExist();

        fixture.save(1L, "existing", runtimeSchedule(), null, 1L);
        var existingFiles = fixture.files();
        assertThatThrownBy(() -> fixture.save(1L, "existing", null, settings, 1L))
                .isInstanceOfSatisfying(ResponseStatusException.class, ex -> assertThat(ex.getStatusCode().value()).isEqualTo(422));
        assertThat(fixture.files()).isEqualTo(existingFiles);
    }

    @Test
    void documentEndpointValidatesDraftFrequencyAndRejectsUpstreamMismatchWithoutWrites() throws Exception {
        DocumentEndpointFixture fixture = new DocumentEndpointFixture();
        fixture.save(1L, "upstream", runtimeSchedule(), null, 1L);
        var settings = new OfflineFlowDependencySettings(List.of(new OfflineFlowDependencyRef(1L, "upstream")), null, null);
        var hourly = new OfflineFlowSchedule("0 * * * *", "Asia/Shanghai", true, OfflineSchedulePeriod.HOURLY);
        fixture.save(1L, "downstream", hourly, null, 1L);
        // Persisted HOURLY must not prevent switching to DAILY and adding the dependency in one save.
        fixture.save(1L, "downstream", runtimeSchedule(), settings, 1L);
        var before = fixture.files();

        assertThatThrownBy(() -> fixture.save(1L, "downstream", hourly, null, 1L))
                .isInstanceOfSatisfying(ResponseStatusException.class, ex -> assertThat(ex.getStatusCode().value()).isEqualTo(422));

        assertThat(fixture.files()).isEqualTo(before);
        var later = new OfflineFlowSchedule("0 9 * * *", "Asia/Shanghai", true, OfflineSchedulePeriod.DAILY);
        assertThat(fixture.save(1L, "downstream", later, null, 1L).schedule()).isEqualTo(later);
    }

    @Test
    void documentEndpointProtectsHiddenDownstreamWithoutLeakingItsIdentity() throws Exception {
        DocumentEndpointFixture fixture = new DocumentEndpointFixture();
        fixture.save(1L, "upstream", runtimeSchedule(), null, 1L);
        fixture.save(2L, "private_downstream", runtimeSchedule(),
                new OfflineFlowDependencySettings(List.of(new OfflineFlowDependencyRef(1L, "upstream")), null, null), 1L, 2L);
        var before = fixture.files();
        var hourly = new OfflineFlowSchedule("0 * * * *", "Asia/Shanghai", true, OfflineSchedulePeriod.HOURLY);

        assertThatThrownBy(() -> fixture.save(1L, "upstream", hourly, null, 1L))
                .isInstanceOfSatisfying(ResponseStatusException.class, ex -> {
                    assertThat(ex.getStatusCode().value()).isEqualTo(422);
                    assertThat(ex.getReason()).contains("无权查看").doesNotContain("private_downstream", "group-2");
                });
        assertThatThrownBy(() -> fixture.save(1L, "upstream", null,
                new OfflineFlowDependencySettings(List.of(), null, OfflineCrossGroupDependency.DENY), 1L))
                .isInstanceOfSatisfying(ResponseStatusException.class, ex -> {
                    assertThat(ex.getStatusCode().value()).isEqualTo(422);
                    assertThat(ex.getReason()).doesNotContain("private_downstream", "group-2");
                });
        assertThat(fixture.files()).isEqualTo(before);
        assertThat(fixture.dependencies.findDependents(1L, "_flows/upstream/flow.yaml", fixture.groups(1L))).isEmpty();
        var later = new OfflineFlowSchedule("0 9 * * *", "Asia/Shanghai", true, OfflineSchedulePeriod.DAILY);
        assertThat(fixture.save(1L, "upstream", later, null, 1L).schedule()).isEqualTo(later);
    }

    @Test
    void documentEndpointDetectsCyclesThroughInvisibleGroups() throws Exception {
        DocumentEndpointFixture fixture = new DocumentEndpointFixture();
        fixture.save(1L, "a", runtimeSchedule(), null, 1L);
        fixture.save(2L, "hidden", runtimeSchedule(),
                new OfflineFlowDependencySettings(List.of(new OfflineFlowDependencyRef(1L, "a")), null, null), 1L, 2L);
        fixture.save(1L, "b", runtimeSchedule(),
                new OfflineFlowDependencySettings(List.of(new OfflineFlowDependencyRef(2L, "hidden")), null, null), 1L, 2L);
        var before = fixture.files();

        assertThatThrownBy(() -> fixture.save(1L, "a", null,
                new OfflineFlowDependencySettings(List.of(new OfflineFlowDependencyRef(1L, "b")), null, null), 1L))
                .isInstanceOfSatisfying(ResponseStatusException.class, ex -> {
                    assertThat(ex.getStatusCode().value()).isEqualTo(422);
                    assertThat(ex.getReason()).contains("循环").doesNotContain("hidden", "group-2");
                });
        assertThat(fixture.files()).isEqualTo(before);
    }

    @Test
    void concurrentDocumentSavesCannotIntroduceACrossGroupCycle() throws Exception {
        DocumentEndpointFixture fixture = new DocumentEndpointFixture();
        fixture.save(1L, "a", runtimeSchedule(), null, 1L);
        fixture.save(2L, "b", runtimeSchedule(), null, 2L);
        var start = new java.util.concurrent.CountDownLatch(1);
        var executor = java.util.concurrent.Executors.newFixedThreadPool(2);
        try {
            var first = executor.submit(() -> {
                start.await();
                return fixture.tryDependency(1L, "a", new OfflineFlowDependencyRef(2L, "b"));
            });
            var second = executor.submit(() -> {
                start.await();
                return fixture.tryDependency(2L, "b", new OfflineFlowDependencyRef(1L, "a"));
            });
            start.countDown();
            assertThat(List.of(first.get(5, java.util.concurrent.TimeUnit.SECONDS), second.get(5, java.util.concurrent.TimeUnit.SECONDS)))
                    .containsExactlyInAnyOrder(200, 422);
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    void graphLockRejectsUnsafeUpgradeInsteadOfDeadlocking() {
        RepoLockManager locks = new RepoLockManager();
        assertThatThrownBy(() -> locks.withLock(1L, () -> locks.withGraphLock(() -> null)))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("之前");
    }

    private class DocumentEndpointFixture {
        final OfflineProperties properties = offlineProperties();
        final RepoLockManager locks = new RepoLockManager();
        final OfflineFlowDocumentService documents = service(properties, locks);
        final OfflineFlowContentService content = new OfflineFlowContentService(properties, locks, new OfflineKestraFlowFileService(properties));
        final OfflineFlowDependencyService dependencies = new OfflineFlowDependencyService(properties, content, locks,
                new com.wbdata.auth.service.PermissionService());
        final java.util.concurrent.atomic.AtomicInteger revision = new java.util.concurrent.atomic.AtomicInteger();

        List<ProjectGroupContextItem> groups(long... ids) {
            return java.util.Arrays.stream(ids).mapToObj(id -> new ProjectGroupContextItem(id, "group-" + id, "", "GROUP_ADMIN")).toList();
        }

        OfflineFlowDocumentResponse save(long groupId, String name, OfflineFlowSchedule schedule,
                                         OfflineFlowDependencySettings settings, long... accessibleGroups) {
            var context = new GroupAuthContext(
                    new AuthSession(1L, "test", "test", "ADMIN", Instant.now().plusSeconds(3600)),
                    groupId, "group-" + groupId);
            AuthContextService authContextService = mock(AuthContextService.class);
            when(authContextService.listAccessibleGroups(context.user())).thenReturn(groups(accessibleGroups));
            OfflineFlowController controller = new OfflineFlowController(content, documents, dependencies, authContextService);
            int version = revision.incrementAndGet();
            controller.saveFlowDocument(context, new SaveOfflineFlowDocumentRequest(
                    999L, "_flows/" + name + "/flow.yaml", null, 0L,
                    List.of(new SaveOfflineFlowStageRequest("main", List.of(new SaveOfflineFlowNodeRequest(
                            "node", "echo " + version, "SHELL", "scripts/" + name + "/node.sh", null, null)))),
                    List.of(), Map.of("node", new NodePosition(version, 20)), schedule,
                    null, null, "Asia/Shanghai", settings));
            return documents.getFlowDocument(groupId, "_flows/" + name + "/flow.yaml");
        }

        int tryDependency(long groupId, String name, OfflineFlowDependencyRef ref) {
            try {
                save(groupId, name, null, new OfflineFlowDependencySettings(List.of(ref), null, null), 1L, 2L);
                return 200;
            } catch (ResponseStatusException ex) {
                return ex.getStatusCode().value();
            }
        }

        Map<String, String> files() throws Exception {
            Map<String, String> result = new java.util.TreeMap<>();
            try (var paths = Files.walk(tempDir)) {
                for (Path path : paths.filter(Files::isRegularFile).toList()) {
                    result.put(tempDir.relativize(path).toString(), Files.getLastModifiedTime(path) + "\n" + Files.readString(path));
                }
            }
            return result;
        }
    }

    @Test
    void saveFlowDocument_persistsScheduleToFlowYamlAndKestraSyncFile() throws Exception {
        OfflineProperties properties = offlineProperties();
        RepoLockManager repoLockManager = new RepoLockManager();
        OfflineFlowDocumentService service = service(properties, repoLockManager);

        var response = service.saveFlowDocument(saveRequest(new OfflineFlowSchedule(
                "* * * * *",
                "Asia/Singapore",
                true,
                OfflineSchedulePeriod.CUSTOM
        )));

        assertThat(response.schedule())
                .usingRecursiveComparison()
                .isEqualTo(new OfflineFlowSchedule("* * * * *", "Asia/Singapore", true, OfflineSchedulePeriod.CUSTOM));

        Path repoPath = properties.resolveRepoPath(1L);
        String flowYaml = Files.readString(repoPath.resolve("_flows/example/flow.yaml"));
        assertThat(flowYaml)
                .contains("triggers:")
                .contains("type: io.kestra.plugin.core.trigger.Schedule")
                .contains("cron:")
                .contains("* * * * *")
                .contains("timezone: Asia/Singapore")
                .contains("recoverMissedSchedules: NONE")
                .contains("wbdataSchedulePeriod: CUSTOM")
                .doesNotContain("disabled: true");

        Path kestraFlowFile = repoPath.resolve(".wb-data/kestra-flows/example.yaml");
        assertThat(Files.readString(kestraFlowFile)).isEqualTo(flowYaml);
    }

    @Test
    void resolveManagedFiles_includesYamlLayoutScriptsAndKestraFlow() {
        OfflineProperties properties = offlineProperties();
        RepoLockManager repoLockManager = new RepoLockManager();
        OfflineFlowDocumentService service = service(properties, repoLockManager);

        service.saveFlowDocument(saveRequest(null));

        assertThat(service.resolveManagedFiles(1L, "_flows/example/flow.yaml"))
                .containsExactlyInAnyOrder(
                        "_flows/example/flow.yaml",
                        "_flows/example/.layout.json",
                        ".wb-data/kestra-flows/example.yaml",
                        "scripts/example/node_1.sh"
                );
    }

    @Test
    void saveFlowDocument_persistsAndReopensScriptlessTransferAlongsideScriptNode() throws Exception {
        OfflineProperties properties = offlineProperties();
        RepoLockManager repoLockManager = new RepoLockManager();
        OfflineFlowDocumentService service = service(properties, repoLockManager);
        TransferConfig transfer = validTransfer();

        service.saveFlowDocument(new SaveOfflineFlowDocumentRequest(
                1L,
                "_flows/example/flow.yaml",
                null,
                0L,
                List.of(new SaveOfflineFlowStageRequest(
                        "main",
                        List.of(
                                new SaveOfflineFlowNodeRequest(
                                        "node_1",
                                        "echo 1",
                                        "SHELL",
                                        "scripts/example/node_1.sh",
                                        null,
                                        null
                                ),
                                new SaveOfflineFlowNodeRequest(
                                        "1transfer_orders",
                                        null,
                                        "TRANSFER",
                                        null,
                                        null,
                                        null,
                                        transfer
                                )
                        )
                )),
                List.of(),
                Map.of(),
                null,
                null,
                null,
                "Asia/Shanghai",
                null
        ));

        var reopened = service.getFlowDocument(1L, "_flows/example/flow.yaml");
        var scriptNode = reopened.stages().getFirst().nodes().getFirst();
        var transferNode = reopened.stages().getFirst().nodes().get(1);

        assertThat(scriptNode.scriptPath()).isEqualTo("scripts/example/node_1.sh");
        assertThat(scriptNode.scriptContent()).isEqualTo("echo 1");
        assertThat(scriptNode.transfer()).isNull();
        assertThat(transferNode.taskId()).isEqualTo("1transfer_orders");
        assertThat(transferNode.kind()).isEqualTo("TRANSFER");
        assertThat(transferNode.scriptPath()).isNull();
        assertThat(transferNode.scriptContent()).isNull();
        assertThat(transferNode.transfer()).usingRecursiveComparison().isEqualTo(transfer);

        Path repoPath = properties.resolveRepoPath(1L);
        assertThat(Files.readString(repoPath.resolve("scripts/example/node_1.sh"))).isEqualTo("echo 1");
        assertThat(repoPath.resolve("transfers/example/1transfer_orders.transfer.json")).isRegularFile();
        assertThat(service.resolveManagedFiles(1L, "_flows/example/flow.yaml"))
                .contains("scripts/example/node_1.sh", "transfers/example/1transfer_orders.transfer.json");
    }

    @Test
    void saveFlowDocument_deletesTransferSidecarForRemovedTransferNode() {
        OfflineProperties properties = offlineProperties();
        RepoLockManager repoLockManager = new RepoLockManager();
        OfflineFlowDocumentService service = service(properties, repoLockManager);

        service.saveFlowDocument(transferOnlyRequest("transfer_1"));
        service.saveFlowDocument(scriptOnlyRequest());

        assertThat(properties.resolveRepoPath(1L)
                .resolve("transfers/example/transfer_1.transfer.json")).doesNotExist();
    }

    @Test
    void saveFlowDocument_bindsValidatedParameterGroupAsManagedImmutableSnapshot() throws Exception {
        OfflineProperties properties = offlineProperties();
        RepoLockManager repoLockManager = new RepoLockManager();
        ParameterGroupService parameterGroupService = mock(ParameterGroupService.class);
        OfflineFlowDocumentService service = service(properties, repoLockManager, parameterGroupService);
        ParameterGroupResponse parameterGroup = parameterGroup(3, "ACTIVE");
        when(parameterGroupService.get(1L, 12L)).thenReturn(parameterGroup);
        when(parameterGroupService.findByCode(1L, "daily_common")).thenReturn(Optional.of(parameterGroup));

        var response = service.saveFlowDocument(saveRequest(
                runtimeSchedule(), new FlowParameterBindingRequest(12L, 3)));

        assertThat(response.parameterBinding().status()).isEqualTo("CURRENT");
        assertThat(response.parameterBinding().boundVersion()).isEqualTo(3);
        assertThat(response.parameterBinding().definitions()).extracting(it -> it.key())
                .containsExactly("name", "v_day");

        Path snapshot = properties.resolveRepoPath(1L).resolve("_flows/example/.parameters.json");
        assertThat(snapshot).isRegularFile();
        assertThat(Files.readString(snapshot))
                .contains("\"schemaVersion\" : 2")
                .contains("\"runtimeTimezone\" : \"Asia/Shanghai\"")
                .contains("\"groupCode\" : \"daily_common\"")
                .contains("\"groupVersion\" : 3")
                .doesNotContain("\"timezone\"")
                .doesNotContain("\"dataType\"")
                .doesNotContain("\"offsetAmount\"")
                .doesNotContain("\"offsetUnit\"")
                .doesNotContain("\"id\"")
                .doesNotContain("createdBy")
                .doesNotContain("updatedBy");
        assertThat(service.resolveManagedFiles(1L, "_flows/example/flow.yaml"))
                .contains("_flows/example/.parameters.json");
    }

    @Test
    void omittedBindingPreservesSnapshotAndReportsOutdatedCurrentVersion() throws Exception {
        OfflineProperties properties = offlineProperties();
        RepoLockManager repoLockManager = new RepoLockManager();
        ParameterGroupService parameterGroupService = mock(ParameterGroupService.class);
        OfflineFlowDocumentService service = service(properties, repoLockManager, parameterGroupService);
        when(parameterGroupService.get(1L, 12L)).thenReturn(parameterGroup(3, "ACTIVE"));
        when(parameterGroupService.findByCode(1L, "daily_common"))
                .thenReturn(Optional.of(parameterGroup(3, "ACTIVE")))
                .thenReturn(Optional.of(parameterGroup(4, "ACTIVE")));

        service.saveFlowDocument(saveRequest(runtimeSchedule(), new FlowParameterBindingRequest(12L, 3)));
        Path snapshot = properties.resolveRepoPath(1L).resolve("_flows/example/.parameters.json");
        String originalSnapshot = Files.readString(snapshot);

        var response = service.saveFlowDocument(saveRequest(null));

        assertThat(Files.readString(snapshot)).isEqualTo(originalSnapshot);
        assertThat(response.parameterBinding().status()).isEqualTo("OUTDATED");
        assertThat(response.parameterBinding().boundVersion()).isEqualTo(3);
        assertThat(response.parameterBinding().currentVersion()).isEqualTo(4);
    }

    @Test
    void explicitEmptyBindingRemovesSnapshot() {
        OfflineProperties properties = offlineProperties();
        RepoLockManager repoLockManager = new RepoLockManager();
        ParameterGroupService parameterGroupService = mock(ParameterGroupService.class);
        OfflineFlowDocumentService service = service(properties, repoLockManager, parameterGroupService);
        ParameterGroupResponse parameterGroup = parameterGroup(3, "ACTIVE");
        when(parameterGroupService.get(1L, 12L)).thenReturn(parameterGroup);
        when(parameterGroupService.findByCode(1L, "daily_common")).thenReturn(Optional.of(parameterGroup));

        service.saveFlowDocument(saveRequest(runtimeSchedule(), new FlowParameterBindingRequest(12L, 3)));
        var response = service.saveFlowDocument(saveRequest(
                null, new FlowParameterBindingRequest(null, null)));

        assertThat(response.parameterBinding()).isNull();
        assertThat(properties.resolveRepoPath(1L).resolve("_flows/example/.parameters.json")).doesNotExist();
    }

    @Test
    void bindingRejectsArchivedOrStaleParameterGroupBeforeWritingFlow() {
        OfflineProperties properties = offlineProperties();
        RepoLockManager repoLockManager = new RepoLockManager();
        ParameterGroupService parameterGroupService = mock(ParameterGroupService.class);
        OfflineFlowDocumentService service = service(properties, repoLockManager, parameterGroupService);
        when(parameterGroupService.get(1L, 12L)).thenReturn(parameterGroup(3, "ARCHIVED"));

        assertThatThrownBy(() -> service.saveFlowDocument(saveRequest(
                null, new FlowParameterBindingRequest(12L, 3))))
                .hasMessageContaining("已归档");
        assertThat(properties.resolveRepoPath(1L).resolve("_flows/example/flow.yaml")).doesNotExist();

        when(parameterGroupService.get(1L, 12L)).thenReturn(parameterGroup(4, "ACTIVE"));
        assertThatThrownBy(() -> service.saveFlowDocument(saveRequest(
                null, new FlowParameterBindingRequest(12L, 3))))
                .hasMessageContaining("版本已变化");
        assertThat(properties.resolveRepoPath(1L).resolve("_flows/example/flow.yaml")).doesNotExist();
    }

    @Test
    void readReportsArchivedAndMissingWithoutChangingBoundSnapshot() {
        OfflineProperties properties = offlineProperties();
        RepoLockManager repoLockManager = new RepoLockManager();
        ParameterGroupService parameterGroupService = mock(ParameterGroupService.class);
        OfflineFlowDocumentService service = service(properties, repoLockManager, parameterGroupService);
        when(parameterGroupService.get(1L, 12L)).thenReturn(parameterGroup(3, "ACTIVE"));
        when(parameterGroupService.findByCode(1L, "daily_common"))
                .thenReturn(Optional.of(parameterGroup(3, "ACTIVE")))
                .thenReturn(Optional.of(parameterGroup(3, "ARCHIVED")))
                .thenReturn(Optional.empty());

        service.saveFlowDocument(saveRequest(runtimeSchedule(), new FlowParameterBindingRequest(12L, 3)));

        var archived = service.getFlowDocument(1L, "_flows/example/flow.yaml");
        var missing = service.getFlowDocument(1L, "_flows/example/flow.yaml");

        assertThat(archived.parameterBinding().status()).isEqualTo("ARCHIVED");
        assertThat(missing.parameterBinding().status()).isEqualTo("MISSING");
        assertThat(missing.parameterBinding().parameterGroupId()).isNull();
        assertThat(missing.parameterBinding().definitions()).extracting(it -> it.key())
                .containsExactly("name", "v_day");
    }

    @Test
    void parameterSnapshotParticipatesInDocumentConflictDetection() throws Exception {
        OfflineProperties properties = offlineProperties();
        RepoLockManager repoLockManager = new RepoLockManager();
        ParameterGroupService parameterGroupService = mock(ParameterGroupService.class);
        OfflineFlowDocumentService service = service(properties, repoLockManager, parameterGroupService);
        ParameterGroupResponse parameterGroup = parameterGroup(3, "ACTIVE");
        when(parameterGroupService.get(1L, 12L)).thenReturn(parameterGroup);
        when(parameterGroupService.findByCode(1L, "daily_common")).thenReturn(Optional.of(parameterGroup));
        var saved = service.saveFlowDocument(saveRequest(
                runtimeSchedule(), new FlowParameterBindingRequest(12L, 3)));
        Path snapshot = properties.resolveRepoPath(1L).resolve("_flows/example/.parameters.json");
        Files.writeString(snapshot, Files.readString(snapshot) + " ");

        SaveOfflineFlowDocumentRequest staleSave = saveRequest(null);
        staleSave = new SaveOfflineFlowDocumentRequest(
                staleSave.groupId(),
                staleSave.path(),
                saved.documentHash(),
                saved.documentUpdatedAt(),
                staleSave.stages(),
                staleSave.edges(),
                staleSave.layout(),
                staleSave.schedule(),
                null,
                null,
                "Asia/Shanghai",
                null
        );

        SaveOfflineFlowDocumentRequest request = staleSave;
        assertThatThrownBy(() -> service.saveFlowDocument(request))
                .isInstanceOfSatisfying(ResponseStatusException.class, ex -> assertThat(ex.getStatusCode().value()).isEqualTo(409))
                .hasMessageContaining("文件已被修改");
    }

    @Test
    @SuppressWarnings("unchecked")
    void boundSqlParametersCompileIntoKestraInputsAndWholeJsonMap() throws Exception {
        OfflineProperties properties = offlineProperties();
        RepoLockManager repoLockManager = new RepoLockManager();
        ParameterGroupService parameterGroupService = mock(ParameterGroupService.class);
        DataSourceService dataSourceService = mock(DataSourceService.class);
        OfflineFlowDocumentService service = service(
                properties, repoLockManager, parameterGroupService, dataSourceService);
        ParameterGroupResponse parameterGroup = parameterGroup(3, "ACTIVE");
        when(parameterGroupService.get(1L, 12L)).thenReturn(parameterGroup);
        when(parameterGroupService.findByCode(1L, "daily_common")).thenReturn(Optional.of(parameterGroup));
        when(dataSourceService.getById(1L)).thenReturn(mysqlDataSource());

        service.saveFlowDocument(sqlSaveRequest(
                "select * from users where name = ^[name] and day = ^[v_day]",
                new FlowParameterBindingRequest(12L, 3)
        ));

        Path repo = properties.resolveRepoPath(1L);
        String flowYaml = Files.readString(repo.resolve("_flows/example/flow.yaml"));
        Map<String, Object> root = new Yaml().load(flowYaml);
        assertThat((Map<String, Object>) root.get("labels"))
                .containsEntry(ExecutionParameterSnapshotRegistry.LABEL_KEY, "snapshot-1");
        assertThat((List<Map<String, Object>>) root.get("inputs")).containsExactly(
                Map.of("id", "name", "type", "STRING", "defaults", "小明"),
                Map.of("id", "v_day", "type", "STRING", "required", false),
                Map.of("id", "wbdata_planned_time", "type", "DATETIME", "required", false)
        );
        Map<String, Object> dag = ((List<Map<String, Object>>) root.get("tasks")).getFirst();
        Map<String, Object> wrapper = ((List<Map<String, Object>>) dag.get("tasks")).getFirst();
        Map<String, Object> task = (Map<String, Object>) wrapper.get("task");
        assertThat(task.get("type")).isEqualTo("io.wbdata.kestra.jdbc.mysql.Query");
        assertThat(task.get("parameters")).isEqualTo(
                "{{ {\"name\": inputs.name, \"v_day\": (inputs.v_day ?? "
                        + "((inputs.wbdata_planned_time ?? trigger.date) | date(\"yyyyMMdd\", "
                        + "timeZone=\"Asia/Shanghai\")))} | toJson }}"
        );
        assertThat(Files.readString(repo.resolve("scripts/example/query.sql")))
                .isEqualTo("select * from users where name = ^[name] and day = ^[v_day]");
        assertThat(Files.readString(repo.resolve(".wb-data/kestra-flows/example.yaml"))).isEqualTo(flowYaml);

        service.saveFlowDocument(sqlSaveRequest(
                "select 1",
                new FlowParameterBindingRequest(null, null)
        ));
        Map<String, Object> unboundRoot = new Yaml().load(
                Files.readString(repo.resolve("_flows/example/flow.yaml")));
        assertThat(unboundRoot).doesNotContainKey("inputs");
        assertThat(unboundRoot).extracting("labels")
                .isEqualTo(Map.of(
                        "wbdataRuntimeTimezone", "Asia/Shanghai",
                        "wbdataSchedulePeriod", "DAILY"));
        Map<String, Object> unboundDag = ((List<Map<String, Object>>) unboundRoot.get("tasks")).getFirst();
        Map<String, Object> unboundWrapper = ((List<Map<String, Object>>) unboundDag.get("tasks")).getFirst();
        assertThat((Map<String, Object>) unboundWrapper.get("task")).doesNotContainKey("parameters");
    }

    @Test
    void missingSqlParameterFailsBeforeWritingFlowOrSnapshot() {
        OfflineProperties properties = offlineProperties();
        RepoLockManager repoLockManager = new RepoLockManager();
        ParameterGroupService parameterGroupService = mock(ParameterGroupService.class);
        DataSourceService dataSourceService = mock(DataSourceService.class);
        OfflineFlowDocumentService service = service(
                properties, repoLockManager, parameterGroupService, dataSourceService);
        when(parameterGroupService.get(1L, 12L)).thenReturn(parameterGroup(3, "ACTIVE"));
        when(dataSourceService.getById(1L)).thenReturn(mysqlDataSource());

        assertThatThrownBy(() -> service.saveFlowDocument(sqlSaveRequest(
                "select * from users where missing = ^[missing]",
                new FlowParameterBindingRequest(12L, 3)
        )))
                .hasMessageContaining("query")
                .hasMessageContaining("missing");

        Path repo = properties.resolveRepoPath(1L);
        assertThat(repo.resolve("_flows/example/flow.yaml")).doesNotExist();
        assertThat(repo.resolve("_flows/example/.parameters.json")).doesNotExist();
    }

    @Test
    @SuppressWarnings("unchecked")
    void compileFlowDraftUsesBoundSnapshotForUnsavedSqlChanges() {
        OfflineProperties properties = offlineProperties();
        RepoLockManager repoLockManager = new RepoLockManager();
        ParameterGroupService parameterGroupService = mock(ParameterGroupService.class);
        DataSourceService dataSourceService = mock(DataSourceService.class);
        OfflineFlowDocumentService service = service(
                properties, repoLockManager, parameterGroupService, dataSourceService);
        ParameterGroupResponse parameterGroup = parameterGroup(3, "ACTIVE");
        when(parameterGroupService.get(1L, 12L)).thenReturn(parameterGroup);
        when(parameterGroupService.findByCode(1L, "daily_common")).thenReturn(Optional.of(parameterGroup));
        when(dataSourceService.getById(1L)).thenReturn(mysqlDataSource());

        var saved = service.saveFlowDocument(sqlSaveRequest(
                "select * from users where name = ^[name]",
                new FlowParameterBindingRequest(12L, 3)
        ));
        SaveOfflineFlowDocumentRequest unsavedDraft = sqlSaveRequest(
                "select * from users where name = ^[name] and day = ^[v_day]",
                null
        );

        var compiled = service.compileFlowDraft(new DebugDocumentExecutionRequest(
                1L,
                "_flows/example/flow.yaml",
                saved.documentHash(),
                saved.documentUpdatedAt(),
                unsavedDraft.stages(),
                unsavedDraft.edges(),
                unsavedDraft.layout(),
                List.of("query"),
                "SELECTED"
        ));

        Map<String, Object> root = new Yaml().load(compiled.content());
        assertThat((List<Map<String, Object>>) root.get("inputs"))
                .extracting(input -> input.get("id"))
                .containsExactly("name", "v_day", "wbdata_planned_time");
        Map<String, Object> dag = ((List<Map<String, Object>>) root.get("tasks")).getFirst();
        Map<String, Object> wrapper = ((List<Map<String, Object>>) dag.get("tasks")).getFirst();
        Map<String, Object> task = (Map<String, Object>) wrapper.get("task");
        assertThat(task.get("parameters").toString())
                .contains("inputs.name")
                .contains("inputs.v_day")
                .contains("inputs.wbdata_planned_time ?? trigger.date")
                .doesNotContain("trigger.date ?? execution.startDate");
        assertThat(compiled.namespaceFileContents().get("scripts/example/query.sql"))
                .isEqualTo("select * from users where name = ^[name] and day = ^[v_day]");
    }

    @Test
    @SuppressWarnings("unchecked")
    void transferSaveAndUnsavedDebugCompileParametersWithoutMutatingSidecar() throws Exception {
        OfflineProperties properties = offlineProperties();
        ParameterGroupService groups = mock(ParameterGroupService.class);
        ParameterGroupResponse group = parameterGroup(3, "ACTIVE");
        when(groups.get(1L, 12L)).thenReturn(group);
        when(groups.findByCode(1L, "daily_common")).thenReturn(Optional.of(group));
        OfflineFlowDocumentService service = service(properties, new RepoLockManager(), groups);
        var saved = service.saveFlowDocument(transferParameterRequest("^[name]", new FlowParameterBindingRequest(12L, 3)));
        Path repo = properties.resolveRepoPath(1L);
        Path flow = repo.resolve("_flows/example/flow.yaml");
        Path sidecar = repo.resolve("transfers/example/transfer_1.transfer.json");
        String savedYaml = Files.readString(flow);
        String savedSidecar = Files.readString(sidecar);
        String savedSnapshot = Files.readString(repo.resolve("_flows/example/.parameters.json"));
        Map<String, Object> savedRoot = new Yaml().load(savedYaml);
        Map<String, Object> savedDag = ((List<Map<String, Object>>) savedRoot.get("tasks")).getFirst();
        Map<String, Object> savedWrapper = ((List<Map<String, Object>>) savedDag.get("tasks")).getFirst();
        Map<String, Object> savedTask = (Map<String, Object>) savedWrapper.get("task");
        assertThat(savedTask.get("inputFiles")).isEqualTo(Map.of("wb-data-transfer-parameters.json",
                "{{ {\"name\": inputs.name} | toJson }}"));
        assertThat(savedSidecar).contains("prefix-^[name]", "select ^[name]").doesNotContain("小明", "parameters");
        assertThat(Files.readString(repo.resolve(".wb-data/kestra-flows/example.yaml"))).isEqualTo(savedYaml);

        SaveOfflineFlowDocumentRequest draft = transferParameterRequest("^[v_day]", null);
        var compiled = service.compileFlowDraft(new DebugDocumentExecutionRequest(1L, "_flows/example/flow.yaml",
                saved.documentHash(), saved.documentUpdatedAt(), draft.stages(), draft.edges(), draft.layout(),
                List.of("transfer_1"), "SELECTED"));
        Map<String, Object> root = new Yaml().load(compiled.content());
        assertThat((List<Map<String, Object>>) root.get("inputs")).extracting(input -> input.get("id"))
                .containsExactly("name", "v_day", "wbdata_planned_time");
        Map<String, Object> dag = ((List<Map<String, Object>>) root.get("tasks")).getFirst();
        Map<String, Object> wrapper = ((List<Map<String, Object>>) dag.get("tasks")).getFirst();
        Map<String, Object> task = (Map<String, Object>) wrapper.get("task");
        assertThat(((Map<String, String>) task.get("inputFiles")).get("wb-data-transfer-parameters.json"))
                .contains("inputs.name", "inputs.v_day", "inputs.wbdata_planned_time ?? trigger.date", "Asia/Shanghai");
        assertThat(compiled.namespaceFileContents().get("transfers/example/transfer_1.transfer.json"))
                .contains("select ^[v_day]");

        SaveOfflineFlowDocumentRequest invalidDraft = transferParameterRequest("^[missing]", null);
        assertThatThrownBy(() -> service.compileFlowDraft(new DebugDocumentExecutionRequest(1L, "_flows/example/flow.yaml",
                saved.documentHash(), saved.documentUpdatedAt(), invalidDraft.stages(), invalidDraft.edges(), invalidDraft.layout(),
                List.of("transfer_1"), "SELECTED"))).hasMessageContaining("transfer_1").hasMessageContaining("missing");
        assertThat(Files.readString(flow)).isEqualTo(savedYaml);
        assertThat(Files.readString(sidecar)).isEqualTo(savedSidecar);
        assertThat(Files.readString(repo.resolve("_flows/example/.parameters.json"))).isEqualTo(savedSnapshot);
    }

    @Test
    void missingTransferPostParameterRejectsSaveBeforeWritingAnyManagedFiles() {
        OfflineProperties properties = offlineProperties();
        ParameterGroupService groups = mock(ParameterGroupService.class);
        when(groups.get(1L, 12L)).thenReturn(parameterGroup(3, "ACTIVE"));
        OfflineFlowDocumentService service = service(properties, new RepoLockManager(), groups);
        assertThatThrownBy(() -> service.saveFlowDocument(
                transferParameterRequest("^[missing]", new FlowParameterBindingRequest(12L, 3))))
                .hasMessageContaining("transfer_1").hasMessageContaining("未定义参数: missing");
        Path repo = properties.resolveRepoPath(1L);
        assertThat(repo.resolve("_flows/example/flow.yaml")).doesNotExist();
        assertThat(repo.resolve("_flows/example/.parameters.json")).doesNotExist();
        assertThat(repo.resolve("transfers/example/transfer_1.transfer.json")).doesNotExist();
        assertThat(repo.resolve(".wb-data/kestra-flows/example.yaml")).doesNotExist();
    }

    @Test
    void saveFlowDocument_allowsUnboundSqlNodeAndPreservesKindAndType() throws Exception {
        OfflineProperties properties = offlineProperties();
        RepoLockManager repoLockManager = new RepoLockManager();
        OfflineFlowDocumentService service = service(properties, repoLockManager);

        SaveOfflineFlowDocumentRequest request = new SaveOfflineFlowDocumentRequest(
                1L,
                "_flows/test/test2/flow.yaml",
                null,
                0L,
                List.of(new SaveOfflineFlowStageRequest(
                        "main",
                        List.of(new SaveOfflineFlowNodeRequest(
                                "mysql_node_1",
                                "-- SQL script",
                                "MYSQL",
                                "scripts/test/test2/mysql_node_1.sql",
                                null,
                                "MYSQL"
                        ))
                )),
                List.of(),
                Map.of("mysql_node_1", new NodePosition(100, 100)),
                null,
                null,
                null,
                "Asia/Shanghai",
                null
        );

        OfflineFlowDocumentResponse response = service.saveFlowDocument(request);
        assertThat(response).isNotNull();
        OfflineFlowNodeResponse node = findNodeInResponse(response, "mysql_node_1");
        assertThat(node).isNotNull();
        assertThat(node.kind()).isEqualTo("MYSQL");
        assertThat(node.dataSourceId()).isNull();
        assertThat(node.dataSourceType()).isEqualTo("MYSQL");

        OfflineFlowDocumentResponse reloaded = service.getFlowDocument(1L, "_flows/test/test2/flow.yaml");
        OfflineFlowNodeResponse reloadedNode = findNodeInResponse(reloaded, "mysql_node_1");
        assertThat(reloadedNode).isNotNull();
        assertThat(reloadedNode.kind()).isEqualTo("MYSQL");
        assertThat(reloadedNode.dataSourceId()).isNull();
        assertThat(reloadedNode.dataSourceType()).isEqualTo("MYSQL");
    }

    private OfflineFlowNodeResponse findNodeInResponse(OfflineFlowDocumentResponse response, String taskId) {
        for (var stage : response.stages()) {
            for (OfflineFlowNodeResponse node : stage.nodes()) {
                if (node.taskId().equals(taskId)) return node;
            }
        }
        return null;
    }

    private SaveOfflineFlowDocumentRequest transferParameterRequest(String postValue, FlowParameterBindingRequest binding) {
        TransferConfig transfer = new TransferConfig(validTransfer().source(),
                new TransferEndpointConfig(2L, "MYSQL", "warehouse", "orders", null, TransferWriteMode.APPEND,
                        List.of("select ^[name]"), List.of("select " + postValue)),
                List.of(new TransferFieldMapping("order_id", TransferMappingKind.STATIC_VALUE, null, null, "prefix-^[name]")),
                List.of());
        return new SaveOfflineFlowDocumentRequest(1L, "_flows/example/flow.yaml", null, 0L,
                List.of(new SaveOfflineFlowStageRequest("main", List.of(new SaveOfflineFlowNodeRequest(
                        "transfer_1", null, "TRANSFER", null, null, null, transfer)))),
                List.of(), Map.of(), runtimeSchedule(), binding, null, "Asia/Shanghai", null);
    }

    private OfflineProperties offlineProperties() {
        OfflineProperties properties = new OfflineProperties();
        properties.setRepoBaseDir(tempDir.toString());
        properties.setRepoDirPrefix("wb-data-");
        return properties;
    }

    private OfflineFlowDocumentService service(OfflineProperties properties, RepoLockManager repoLockManager) {
        return service(properties, repoLockManager, mock(ParameterGroupService.class));
    }

    private OfflineFlowDocumentService service(OfflineProperties properties,
                                               RepoLockManager repoLockManager,
                                               ParameterGroupService parameterGroupService) {
        return service(properties, repoLockManager, parameterGroupService, mock(DataSourceService.class));
    }

    private OfflineFlowDocumentService service(OfflineProperties properties,
                                               RepoLockManager repoLockManager,
                                               ParameterGroupService parameterGroupService,
                                               DataSourceService dataSourceService) {
        OfflineKestraFlowFileService kestraFlowFileService = new OfflineKestraFlowFileService(properties);
        ExecutionParameterSnapshotRegistry snapshotRegistry = mock(ExecutionParameterSnapshotRegistry.class);
        when(snapshotRegistry.register(org.mockito.ArgumentMatchers.anyLong(), org.mockito.ArgumentMatchers.any()))
                .thenReturn("snapshot-1");
        FlowParameterSnapshotStore parameterSnapshotStore = new FlowParameterSnapshotStore(new ObjectMapper());
        TransferConfigFileService transferConfigFileService = new TransferConfigFileService(new ObjectMapper());
        return new OfflineFlowDocumentService(
                properties,
                new OfflineFlowContentService(properties, repoLockManager, kestraFlowFileService),
                repoLockManager,
                kestraFlowFileService,
                transferConfigFileService,
                parameterSnapshotStore,
                new FlowParameterBindingAssembler(parameterGroupService, parameterSnapshotStore),
                new FlowGraphDraftBuilder(dataSourceService, transferConfigFileService),
                snapshotRegistry,
                new OfflineTransferProperties()
        );
    }

    private SaveOfflineFlowDocumentRequest saveRequest(OfflineFlowSchedule schedule) {
        return saveRequest(schedule, null);
    }

    private SaveOfflineFlowDocumentRequest saveRequest(OfflineFlowSchedule schedule,
                                                       FlowParameterBindingRequest parameterBinding) {
        return new SaveOfflineFlowDocumentRequest(
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
                Map.of("node_1", new NodePosition(10, 20)),
                schedule,
                parameterBinding,
                null,
                schedule == null ? "Asia/Shanghai" : schedule.timezone(),
                null
        );
    }

    private SaveOfflineFlowDocumentRequest transferOnlyRequest(String taskId) {
        return new SaveOfflineFlowDocumentRequest(
                1L, "_flows/example/flow.yaml", null, 0L,
                List.of(new SaveOfflineFlowStageRequest("main", List.of(new SaveOfflineFlowNodeRequest(
                        taskId, null, "TRANSFER", null, null, null, validTransfer()
                )))),
                List.of(), Map.of(), null, null, null, "Asia/Shanghai", null
        );
    }

    private SaveOfflineFlowDocumentRequest scriptOnlyRequest() {
        return new SaveOfflineFlowDocumentRequest(
                1L, "_flows/example/flow.yaml", null, 0L,
                List.of(new SaveOfflineFlowStageRequest("main", List.of(new SaveOfflineFlowNodeRequest(
                        "node_1", "echo 1", "SHELL", "scripts/example/node_1.sh", null, null
                )))),
                List.of(), Map.of(), null, null, null, "Asia/Shanghai", null
        );
    }

    private SaveOfflineFlowDocumentRequest sqlSaveRequest(String sql,
                                                          FlowParameterBindingRequest parameterBinding) {
        return new SaveOfflineFlowDocumentRequest(
                1L,
                "_flows/example/flow.yaml",
                null,
                0L,
                List.of(new SaveOfflineFlowStageRequest(
                        "main",
                        List.of(new SaveOfflineFlowNodeRequest(
                                "query", sql, "SQL", "scripts/example/query.sql", 1L, "MYSQL"
                        ))
                )),
                List.of(),
                Map.of(),
                runtimeSchedule(),
                parameterBinding,
                null,
                runtimeSchedule().timezone(),
                null
        );
    }

    private OfflineFlowSchedule runtimeSchedule() {
        return new OfflineFlowSchedule("0 2 * * *", "Asia/Shanghai", false, OfflineSchedulePeriod.DAILY);
    }

    private TransferConfig validTransfer() {
        return new TransferConfig(
                new TransferEndpointConfig(1L, "MYSQL", "source_db", "orders", "id > 0", null, null, null),
                new TransferEndpointConfig(2L, "HIVE", "target_db", "dwd_orders", null,
                        TransferWriteMode.APPEND, null, null),
                List.of(new TransferFieldMapping(
                        "order_id",
                        TransferMappingKind.SOURCE_FIELD,
                        "id",
                        null
                )),
                List.of()
        );
    }

    private ParameterGroupResponse parameterGroup(int version, String status) {
        return new ParameterGroupResponse(
                12L,
                "daily_common",
                "每日公共参数",
                null,
                version,
                1,
                status,
                8L,
                9L,
                null,
                null,
                List.of(
                        new ParameterDefinitionResponse(
                                1L, "name", "CONSTANT", "小明",
                                null, null, 0, null, 0),
                        new ParameterDefinitionResponse(
                                2L, "v_day", "SYSTEM_TIME", null,
                                "PLANNED_TIME", "yyyyMMdd", 0, null, 1)
                )
        );
    }

    @Test
    void saveFlowDocument_requiresRuntimeTimezone() {
        OfflineProperties properties = offlineProperties();
        RepoLockManager repoLockManager = new RepoLockManager();
        ParameterGroupService parameterGroupService = mock(ParameterGroupService.class);
        OfflineFlowDocumentService service = service(properties, repoLockManager, parameterGroupService);

        assertThatThrownBy(() -> service.saveFlowDocument(new SaveOfflineFlowDocumentRequest(
                1L,
                "_flows/example/flow.yaml",
                null,
                0L,
                List.of(new SaveOfflineFlowStageRequest(
                        "stage_1",
                        List.of(new SaveOfflineFlowNodeRequest("node_1", "echo 1", "SHELL", "scripts/example/node_1.sh", null, null, null))
                )),
                List.of(),
                Map.of("node_1", new NodePosition(100, 100)),
                null,
                new FlowParameterBindingRequest(12L, 3),
                null,
                null,
                null
        )))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("任务运行时区不能为空");
    }

    @Test
    void saveFlowDocument_preservesExplicitRuntimeTimezoneWithoutSchedule() {
        OfflineProperties properties = offlineProperties();
        RepoLockManager repoLockManager = new RepoLockManager();
        OfflineFlowDocumentService service = service(properties, repoLockManager);

        var response = service.saveFlowDocument(new SaveOfflineFlowDocumentRequest(
                1L,
                "_flows/example/flow.yaml",
                null,
                0L,
                List.of(new SaveOfflineFlowStageRequest(
                        "stage_1",
                        List.of(new SaveOfflineFlowNodeRequest("node_1", "echo 1", "SHELL", "scripts/example/node_1.sh", null, null, null))
                )),
                List.of(),
                Map.of("node_1", new NodePosition(100, 100)),
                null,
                null,
                null,
                "Asia/Kolkata",
                null
        ));

        assertThat(response.schedule()).isNull();
        assertThat(response.runtimeTimezone()).isEqualTo("Asia/Kolkata");

        var readResponse = service.getFlowDocument(1L, "_flows/example/flow.yaml");
        assertThat(readResponse.runtimeTimezone()).isEqualTo("Asia/Kolkata");
    }

    @Test
    void saveFlowDocument_rejectsChangingRuntimeTimezoneAfterCreation() {
        OfflineProperties properties = offlineProperties();
        OfflineFlowDocumentService service = service(properties, new RepoLockManager());
        var saved = service.saveFlowDocument(saveRequest(null));

        SaveOfflineFlowDocumentRequest timezoneChange = new SaveOfflineFlowDocumentRequest(
                1L,
                "_flows/example/flow.yaml",
                saved.documentHash(),
                saved.documentUpdatedAt(),
                List.of(new SaveOfflineFlowStageRequest(
                        "main",
                        List.of(new SaveOfflineFlowNodeRequest(
                                "node_1", "echo 1", "SHELL", "scripts/example/node_1.sh",
                                null, null, null))
                )),
                List.of(),
                Map.of("node_1", new NodePosition(10, 20)),
                null,
                null,
                null,
                "Asia/Singapore",
                null
        );

        assertThatThrownBy(() -> service.saveFlowDocument(timezoneChange))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("任务运行时区创建后不能修改");
        assertThat(service.getFlowDocument(1L, "_flows/example/flow.yaml").runtimeTimezone())
                .isEqualTo("Asia/Shanghai");
    }

    @Test
    void saveFlowDocument_usesFlowRuntimeTimezoneForSchedule() throws Exception {
        OfflineProperties properties = offlineProperties();
        OfflineFlowDocumentService service = service(properties, new RepoLockManager());

        var response = service.saveFlowDocument(new SaveOfflineFlowDocumentRequest(
                1L,
                "_flows/example/flow.yaml",
                null,
                0L,
                List.of(new SaveOfflineFlowStageRequest(
                        "stage_1",
                        List.of(new SaveOfflineFlowNodeRequest(
                                "node_1", "echo 1", "SHELL", "scripts/example/node_1.sh",
                                null, null, null))
                )),
                List.of(),
                Map.of("node_1", new NodePosition(100, 100)),
                new OfflineFlowSchedule("0 2 * * *", "Asia/Singapore", true, OfflineSchedulePeriod.DAILY),
                null,
                null,
                "Asia/Kolkata",
                null
        ));

        assertThat(response.runtimeTimezone()).isEqualTo("Asia/Kolkata");
        assertThat(response.schedule().timezone()).isEqualTo("Asia/Kolkata");
        assertThat(Files.readString(properties.resolveRepoPath(1L)
                .resolve("_flows/example/flow.yaml")))
                .contains("wbdataRuntimeTimezone: Asia/Kolkata")
                .contains("timezone: Asia/Kolkata")
                .doesNotContain("timezone: Asia/Singapore");
    }

    @Test
    void saveFlowDocument_withMultipleParameterBindings_mergesWithPriorityOrder() throws Exception {
        OfflineProperties properties = offlineProperties();
        RepoLockManager repoLockManager = new RepoLockManager();
        ParameterGroupService parameterGroupService = mock(ParameterGroupService.class);

        // Group 1: biz_core (version 1) - has :target_table = "orders_v1", :biz_date
        ParameterGroupResponse group1 = new ParameterGroupResponse(
                101L,
                "biz_core",
                "业务核心参数",
                "核心参数",
                1,
                1,
                "ACTIVE",
                7L,
                7L,
                null,
                null,
                List.of(
                        new ParameterDefinitionResponse(1L, "target_table", "CONSTANT", "orders_v1", "PLANNED_TIME", null, 0, "目标表", 0),
                        new ParameterDefinitionResponse(2L, "biz_date", "SYSTEM_TIME", null, "PLANNED_TIME", "yyyyMMdd", -1, "业务日期", 1)
                )
        );

        // Group 2: global_common (version 2) - has :target_table = "global_default", :env = "prod"
        ParameterGroupResponse group2 = new ParameterGroupResponse(
                102L,
                "global_common",
                "全局通用参数",
                "通用参数",
                2,
                1,
                "ACTIVE",
                7L,
                7L,
                null,
                null,
                List.of(
                        new ParameterDefinitionResponse(3L, "target_table", "CONSTANT", "global_default", "PLANNED_TIME", null, 0, "全局默认表", 0),
                        new ParameterDefinitionResponse(4L, "env", "CONSTANT", "prod", "PLANNED_TIME", null, 0, "环境", 1)
                )
        );

        when(parameterGroupService.get(1L, 101L)).thenReturn(group1);
        when(parameterGroupService.get(1L, 102L)).thenReturn(group2);
        when(parameterGroupService.findByCode(1L, "biz_core")).thenReturn(Optional.of(group1));
        when(parameterGroupService.findByCode(1L, "global_common")).thenReturn(Optional.of(group2));

        OfflineFlowDocumentService service = service(properties, repoLockManager, parameterGroupService);

        var response = service.saveFlowDocument(new SaveOfflineFlowDocumentRequest(
                1L,
                "_flows/example/flow.yaml",
                null,
                0L,
                List.of(new SaveOfflineFlowStageRequest(
                        "stage_1",
                        List.of(new SaveOfflineFlowNodeRequest("node_1", "echo 1", "SHELL", "scripts/example/node_1.sh", null, null, null))
                )),
                List.of(),
                Map.of("node_1", new NodePosition(100, 100)),
                null,
                null,
                List.of(
                        new FlowParameterBindingRequest(101L, 1),
                        new FlowParameterBindingRequest(102L, 2)
                ),
                "Asia/Singapore",
                null
        ));

        assertThat(response.parameterBinding()).isNotNull();
        assertThat(response.parameterBinding().bindings()).hasSize(2);
        assertThat(response.parameterBinding().bindings().stream()
                .map(binding -> binding.code())
                .toList())
                .containsExactly("biz_core", "global_common");
        assertThat(response.parameterBinding().definitions()).hasSize(3);

        // Verify priority: target_table must be from group1 ("orders_v1"), NOT group2 ("global_default")
        var targetTableDef = response.parameterBinding().definitions().stream()
                .filter(d -> "target_table".equals(d.key()))
                .findFirst().orElseThrow();
        assertThat(targetTableDef.constantValue()).isEqualTo("orders_v1");

        // Verify env is present from group2
        var envDef = response.parameterBinding().definitions().stream()
                .filter(d -> "env".equals(d.key()))
                .findFirst().orElseThrow();
        assertThat(envDef.constantValue()).isEqualTo("prod");

        // Verify persistence & reload
        var reloadResponse = service.getFlowDocument(1L, "_flows/example/flow.yaml");
        assertThat(reloadResponse.parameterBinding().bindings()).hasSize(2);
        assertThat(reloadResponse.parameterBinding().definitions()).hasSize(3);
    }

    private DataSource mysqlDataSource() {
        DataSource dataSource = new DataSource();
        dataSource.setId(1L);
        dataSource.setGroupId(1L);
        dataSource.setType("MYSQL");
        dataSource.setHost("db.example");
        dataSource.setPort(3306);
        dataSource.setDatabaseName("warehouse");
        dataSource.setUsername("analyst");
        dataSource.setPassword("password");
        return dataSource;
    }
}
