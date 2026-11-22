package com.wbdata.query.service.impl;

import com.wbdata.auth.context.AuthContext;
import com.wbdata.auth.service.AuthGroupAccessPort;
import com.wbdata.auth.service.AuthSession;
import com.wbdata.datasource.service.AuthorizedDataSourceService;
import com.wbdata.auth.service.GroupAuthorizationService;
import com.wbdata.auth.service.PermissionService;
import com.wbdata.datasource.entity.DataSource;
import com.wbdata.datasource.service.DataSourceService;
import com.wbdata.plugin.api.ColumnMetadata;
import com.wbdata.plugin.api.QueryRowHandler;
import com.wbdata.plugin.api.QueryStreamSummary;
import com.wbdata.query.dto.QueryExportTaskResponse;
import com.wbdata.query.service.QueryService;
import org.apache.poi.ss.usermodel.WorkbookFactory;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.Mockito;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assertions.assertAll;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class QueryExportServiceImplTest {

    private final QueryService queryService = Mockito.mock(QueryService.class);
    private final DataSourceService dataSourceService = Mockito.mock(DataSourceService.class);
    private final AuthGroupAccessPort groupAccessPort = Mockito.mock(AuthGroupAccessPort.class);
    private final GroupAuthorizationService authorizationService = new GroupAuthorizationService(
            groupAccessPort, new PermissionService());
    private final AuthorizedDataSourceService authorizedDataSourceService = new AuthorizedDataSourceService(
            dataSourceService, authorizationService);
    private final QueryExportServiceImpl service = new QueryExportServiceImpl(queryService, authorizedDataSourceService);
    private final DataSource dataSource = new DataSource();
    private final Map<Long, Set<Long>> membershipsByGroup = new LinkedHashMap<>();

    @BeforeEach
    void loginOwner() {
        login(1L, "USER");
        dataSource.setId(1L);
        dataSource.setGroupId(10L);
        when(dataSourceService.getById(1L)).thenReturn(dataSource);
        for (long groupId : List.of(10L, 20L)) {
            membershipsByGroup.put(groupId, new LinkedHashSet<>(List.of(1L, 2L)));
        }
        when(groupAccessPort.findGroupAccess(anyLong(), anyLong(), anyBoolean())).thenAnswer(invocation -> {
            Long groupId = invocation.getArgument(0);
            Long userId = invocation.getArgument(1);
            boolean includeMembership = invocation.getArgument(2);
            Set<Long> members = membershipsByGroup.get(groupId);
            if (members == null) {
                return Optional.empty();
            }
            String role = includeMembership && members.contains(userId) ? "DEVELOPER" : null;
            return Optional.of(new AuthGroupAccessPort.AuthGroupSnapshot(
                    groupId, "group-" + groupId, "active", role));
        });
    }

    private void revokeMembership(Long userId) {
        membershipsByGroup.getOrDefault(10L, Set.of()).remove(userId);
    }

    @AfterEach
    void cleanup() {
        service.shutdown();
        AuthContext.clear();
    }

    @ParameterizedTest
    @ValueSource(strings = {"USER", "SYSTEM_ADMIN"})
    void outsidersCannotListOwnersExports(String systemRole) {
        completedExport();
        login(2L, systemRole);

        assertThat(service.listTasks()).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"USER", "SYSTEM_ADMIN"})
    void outsidersCannotReadOwnersExportDetails(String systemRole) {
        String taskId = completedExport();
        login(2L, systemRole);

        assertNotFound(() -> service.getTask(taskId));
    }

    @ParameterizedTest
    @ValueSource(strings = {"USER", "SYSTEM_ADMIN"})
    void outsidersCannotDownloadOwnersExport(String systemRole) {
        String taskId = completedExport();
        login(2L, systemRole);

        assertAll(
                () -> assertNotFound(() -> service.getDownloadFileName(taskId)),
                () -> assertNotFound(() -> service.getDownloadResource(taskId)));
    }

    @Test
    void unauthenticatedCallersCannotUseAnyExportInterface() {
        String taskId = completedExport();
        AuthContext.clear();

        assertAll(
                () -> assertStatus(HttpStatus.UNAUTHORIZED,
                        () -> service.createExportTask(1L, "select 1", "db", "csv")),
                () -> assertStatus(HttpStatus.UNAUTHORIZED, service::listTasks),
                () -> assertStatus(HttpStatus.UNAUTHORIZED, () -> service.getTask(taskId)),
                () -> assertStatus(HttpStatus.UNAUTHORIZED, () -> service.getDownloadFileName(taskId)),
                () -> assertStatus(HttpStatus.UNAUTHORIZED, () -> service.getDownloadResource(taskId)));
    }

    @Test
    void deniedCreationFailsSynchronouslyWithoutCreatingOrExecutingTask() {
        revokeMembership(1L);

        assertStatus(HttpStatus.FORBIDDEN, () -> service.createExportTask(1L, "select 1", "db", "csv"));
        assertThat(service.listTasks()).isEmpty();
        verifyNoInteractions(queryService);
    }

    @Test
    void disabledDataSourceCannotCreateExportTask() {
        dataSource.setStatus("DISABLED");

        assertStatus(HttpStatus.BAD_REQUEST, () -> service.createExportTask(1L, "select 1", "db", "csv"));
        assertThat(service.listTasks()).isEmpty();
        verifyNoInteractions(queryService);
    }

    @Test
    void revokedMembershipBlocksOwnerDetailsAndBothDownloadInterfaces() {
        String taskId = completedExport();
        revokeMembership(1L);

        assertExportAccessStatus(taskId, HttpStatus.FORBIDDEN);
    }

    @Test
    void deletedDataSourceBlocksOwnerDetailsAndBothDownloadInterfaces() {
        String taskId = completedExport();
        when(dataSourceService.getById(1L)).thenReturn(null);

        assertExportAccessStatus(taskId, HttpStatus.NOT_FOUND);
    }

    @Test
    void movedDataSourceBlocksOldExportEvenWhenOwnerCanExportFromNewGroup() {
        String taskId = completedExport();
        dataSource.setGroupId(20L);

        assertExportAccessStatus(taskId, HttpStatus.FORBIDDEN);
    }

    @Test
    void outsiderGetsSameNotFoundAsMissingTaskBeforeDataSourceAuthorization() {
        String taskId = completedExport();
        revokeMembership(2L);
        login(2L, "USER");

        assertExportAccessStatus(taskId, HttpStatus.NOT_FOUND);
        assertThatThrownBy(() -> service.getTask(taskId))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        exception -> assertThat(exception.getReason()).isEqualTo("导出任务不存在"));
        assertThatThrownBy(() -> service.getTask("missing"))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        exception -> assertThat(exception.getReason()).isEqualTo("导出任务不存在"));
    }

    @Test
    void taskListLimitIsAppliedAfterOwnerFilter() {
        String ownerTask = completedExport();
        login(2L, "USER");
        for (int i = 0; i < 21; i++) {
            completedExport();
        }
        assertThat(service.listTasks()).hasSize(20)
                .extracting(QueryExportTaskResponse::taskId).doesNotContain(ownerTask);

        login(1L, "USER");
        assertThat(service.listTasks()).extracting(QueryExportTaskResponse::taskId).containsExactly(ownerTask);
    }

    @Test
    void workerRunsWithoutAuthContextAndKeepsSynchronousOwnerSnapshot() throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        AtomicReference<AuthSession> workerSession = new AtomicReference<>();
        Mockito.doAnswer(invocation -> {
                    workerSession.set(AuthContext.current());
                    started.countDown();
                    if (!release.await(5, TimeUnit.SECONDS)) {
                        throw new IllegalStateException("等待测试释放 worker 超时");
                    }
                    QueryRowHandler handler = invocation.getArgument(4);
                    handler.onColumns(List.of());
                    return new QueryStreamSummary(0, false, 1L);
                }).when(queryService)
                .streamQuery(Mockito.eq(1L), Mockito.eq("select 1"), Mockito.eq("db"), Mockito.eq(100_000), any());

        String taskId = service.createExportTask(1L, "select 1", "db", "csv").taskId();
        try {
            assertThat(started.await(5, TimeUnit.SECONDS)).isTrue();
            AuthContext.clear();
            assertThat(workerSession.get()).isNull();
        } finally {
            release.countDown();
        }
        login(2L, "SYSTEM_ADMIN");
        assertThat(service.listTasks()).isEmpty();
        login(1L, "USER");
        assertThat(awaitTerminal(taskId).status()).isEqualTo("SUCCESS");
        assertThat(service.getDownloadResource(taskId).exists()).isTrue();
    }

    private void assertExportAccessStatus(String taskId, HttpStatus status) {
        assertAll(
                () -> assertStatus(status, () -> service.getTask(taskId)),
                () -> assertStatus(status, () -> service.getDownloadFileName(taskId)),
                () -> assertStatus(status, () -> service.getDownloadResource(taskId)));
    }

    private String completedExport() {
        Mockito.doAnswer(invocation -> {
                    QueryRowHandler handler = invocation.getArgument(4);
                    handler.onColumns(List.of());
                    return new QueryStreamSummary(0, false, 1L);
                }).when(queryService).streamQuery(anyLong(), anyString(), anyString(), anyInt(), any());
        String taskId = service.createExportTask(1L, "select 1", "db", "csv").taskId();
        assertThat(awaitTerminal(taskId).status()).isEqualTo("SUCCESS");
        return taskId;
    }

    private static void login(Long userId, String systemRole) {
        AuthContext.set(new AuthSession(userId, "user-" + userId, "User", systemRole,
                Instant.now().plusSeconds(3600)));
    }

    private static void assertNotFound(ThrowingCallable action) {
        assertStatus(HttpStatus.NOT_FOUND, action);
    }

    private static void assertStatus(HttpStatus status, ThrowingCallable action) {
        assertThatThrownBy(action).isInstanceOfSatisfying(ResponseStatusException.class,
                exception -> assertThat(exception.getStatusCode()).isEqualTo(status));
    }

    @Test
    void exportSuccessProducesDownloadableFileAndShutdownCleansItUp() throws Exception {
        Mockito.doAnswer(invocation -> {
                    QueryRowHandler handler = invocation.getArgument(4);
                    handler.onColumns(List.of(
                            new ColumnMetadata("id", "INT", 11, false, "", true),
                            new ColumnMetadata("note", "VARCHAR", 64, true, "", false)));
                    handler.onRow(Arrays.asList(1, null));
                    handler.onRow(Arrays.asList(2, "ok, \"quoted\""));
                    return new QueryStreamSummary(2, true, 1L);
                }).when(queryService).streamQuery(anyLong(), anyString(), anyString(), anyInt(), any());

        QueryExportTaskResponse created = service.createExportTask(1L, "select 1", "db", "csv");
        QueryExportTaskResponse finished = awaitTerminal(created.taskId());

        assertThat(finished.status()).isEqualTo("SUCCESS");
        assertThat(finished.exportedRows()).isEqualTo(2);
        assertThat(finished.truncated()).isTrue();
        Resource resource = service.getDownloadResource(created.taskId());
        assertThat(resource.exists()).isTrue();
        Path exported = resource.getFile().toPath();
        assertThat(Files.readString(exported)).isEqualTo("\uFEFFid,note\n1,\n2,\"ok, \"\"quoted\"\"\"\n");

        service.shutdown();
        assertThat(Files.exists(exported)).isFalse();
    }

    @Test
    void streamXlsxExportRendersNullCellsAsEmptyStringsAndPropagatesTruncated() throws Exception {
        Mockito.doAnswer(invocation -> {
                    QueryRowHandler handler = invocation.getArgument(4);
                    handler.onColumns(List.of(
                            new ColumnMetadata("id", "INT", 11, false, "", true),
                            new ColumnMetadata("name", "VARCHAR", 64, true, "", false)));
                    handler.onRow(Arrays.asList(1, null));
                    handler.onRow(Arrays.asList(2, "Alice"));
                    return new QueryStreamSummary(2, true, 1L);
                }).when(queryService).streamQuery(anyLong(), anyString(), anyString(), anyInt(), any());

        QueryExportTaskResponse created = service.createExportTask(1L, "select 1", "db", "xlsx");
        QueryExportTaskResponse finished = awaitTerminal(created.taskId());

        assertThat(finished.status()).isEqualTo("SUCCESS");
        assertThat(finished.exportedRows()).isEqualTo(2);
        assertThat(finished.truncated()).isTrue();

        Path exported = service.getDownloadResource(created.taskId()).getFile().toPath();
        try (InputStream is = Files.newInputStream(exported);
             var workbook = WorkbookFactory.create(is)) {
            var sheet = workbook.getSheet("Result");
            assertThat(sheet.getRow(0).getCell(0).getStringCellValue()).isEqualTo("id");
            assertThat(sheet.getRow(0).getCell(1).getStringCellValue()).isEqualTo("name");
            assertThat(sheet.getRow(1).getCell(0).getStringCellValue()).isEqualTo("1");
            assertThat(sheet.getRow(1).getCell(1).getStringCellValue()).isEmpty();
            assertThat(sheet.getRow(2).getCell(0).getStringCellValue()).isEqualTo("2");
            assertThat(sheet.getRow(2).getCell(1).getStringCellValue()).isEqualTo("Alice");
        }
    }

    @Test
    void exportFailureDeletesTempFileMarksTaskFailedAndBlocksDownload() throws Exception {
        Mockito.doAnswer(invocation -> {
                    QueryRowHandler handler = invocation.getArgument(4);
                    handler.onColumns(List.of(new ColumnMetadata("id", "INT", 11, false, "", true)));
                    handler.onRow(List.of(1));
                    throw new RuntimeException("connection refused");
                }).when(queryService).streamQuery(anyLong(), anyString(), anyString(), anyInt(), any());

        QueryExportTaskResponse created = service.createExportTask(1L, "select 1", "db", "csv");
        QueryExportTaskResponse finished = awaitTerminal(created.taskId());

        assertThat(finished.status()).isEqualTo("FAILED");
        assertThat(finished.errorMessage()).contains("connection refused");
        assertThatThrownBy(() -> service.getDownloadResource(created.taskId()))
                .isInstanceOf(IllegalStateException.class);
        Path tmpDir = Path.of(System.getProperty("java.io.tmpdir"));
        try (Stream<Path> files = Files.list(tmpDir)) {
            assertThat(files.filter(p -> p.getFileName().toString().startsWith("wb-query-export-" + created.taskId())))
                    .isEmpty();
        }
    }

    @Test
    void boundedConcurrencyQueuesExcessTasksUntilPermitIsReleased() throws Exception {
        QueryExportServiceImpl boundedService = new QueryExportServiceImpl(
                queryService, authorizedDataSourceService, 1, 3);
        try {
            CountDownLatch firstStarted = new CountDownLatch(1);
            CountDownLatch releaseFirst = new CountDownLatch(1);
            AtomicInteger activeCount = new AtomicInteger();
            AtomicInteger peakConcurrency = new AtomicInteger();
            Mockito.doAnswer(invocation -> {
                        int active = activeCount.incrementAndGet();
                        peakConcurrency.accumulateAndGet(active, Math::max);
                        try {
                            firstStarted.countDown();
                            releaseFirst.await(5, TimeUnit.SECONDS);
                            QueryRowHandler handler = invocation.getArgument(4);
                            handler.onColumns(List.of());
                            return new QueryStreamSummary(0, false, 1L);
                        } finally {
                            activeCount.decrementAndGet();
                        }
                    }).when(queryService).streamQuery(anyLong(), anyString(), anyString(), anyInt(), any());

            String first = boundedService.createExportTask(1L, "select 1", "db", "csv").taskId();
            assertThat(firstStarted.await(5, TimeUnit.SECONDS)).isTrue();
            String second = boundedService.createExportTask(1L, "select 2", "db", "csv").taskId();
            Thread.sleep(50);

            assertThat(boundedService.getTask(first).status()).isEqualTo("RUNNING");
            assertThat(boundedService.getTask(second).status()).isEqualTo("PENDING");
            assertThat(peakConcurrency.get()).isEqualTo(1);

            releaseFirst.countDown();
            assertThat(awaitTerminal(boundedService, first).status()).isEqualTo("SUCCESS");
            assertThat(awaitTerminal(boundedService, second).status()).isEqualTo("SUCCESS");
            assertThat(peakConcurrency.get()).isEqualTo(1);
        } finally {
            boundedService.shutdown();
        }
    }

    @Test
    void rejectsOverflowExportsWithTooManyRequests() throws Exception {
        QueryExportServiceImpl boundedService = new QueryExportServiceImpl(
                queryService, authorizedDataSourceService, 1, 2);
        try {
            CountDownLatch release = new CountDownLatch(1);
            Mockito.doAnswer(invocation -> {
                        release.await(5, TimeUnit.SECONDS);
                        QueryRowHandler handler = invocation.getArgument(4);
                        handler.onColumns(List.of());
                        return new QueryStreamSummary(0, false, 1L);
                    }).when(queryService).streamQuery(anyLong(), anyString(), anyString(), anyInt(), any());

            String first = boundedService.createExportTask(1L, "select 1", "db", "csv").taskId();
            String second = boundedService.createExportTask(1L, "select 2", "db", "csv").taskId();

            assertStatus(HttpStatus.TOO_MANY_REQUESTS,
                    () -> boundedService.createExportTask(1L, "select 3", "db", "csv"));

            release.countDown();
            assertThat(awaitTerminal(boundedService, first).status()).isEqualTo("SUCCESS");
            assertThat(awaitTerminal(boundedService, second).status()).isEqualTo("SUCCESS");
            String third = boundedService.createExportTask(1L, "select 4", "db", "csv").taskId();
            assertThat(awaitTerminal(boundedService, third).status()).isEqualTo("SUCCESS");
        } finally {
            boundedService.shutdown();
        }
    }

    @Test
    void unsupportedExportFormatReturnsBadRequestWithoutConsumingCapacity() {
        assertStatus(HttpStatus.BAD_REQUEST, () -> service.createExportTask(1L, "select 1", "db", "json"));
        verifyNoInteractions(queryService);
    }

    @Test
    void unknownTaskReturnsNotFound() {
        assertNotFound(() -> service.getTask("missing"));
        assertNotFound(() -> service.getDownloadFileName("missing"));
        assertNotFound(() -> service.getDownloadResource("missing"));
    }

    @Test
    void isExpiredOnlyForTerminalTasksPastTtl() {
        Instant now = Instant.now();
        Instant stale = now.minus(Duration.ofHours(2));

        assertThat(QueryExportServiceImpl.isExpired(task(QueryExportServiceImpl.ExportTaskStatus.SUCCESS, stale), now)).isTrue();
        assertThat(QueryExportServiceImpl.isExpired(task(QueryExportServiceImpl.ExportTaskStatus.FAILED, stale), now)).isTrue();
        assertThat(QueryExportServiceImpl.isExpired(task(QueryExportServiceImpl.ExportTaskStatus.RUNNING, stale), now)).isFalse();
        assertThat(QueryExportServiceImpl.isExpired(task(QueryExportServiceImpl.ExportTaskStatus.SUCCESS, now), now)).isFalse();
    }

    private QueryExportTaskResponse awaitTerminal(String taskId) {
        return awaitTerminal(service, taskId);
    }

    private static QueryExportTaskResponse awaitTerminal(QueryExportServiceImpl targetService, String taskId) {
        long deadline = System.currentTimeMillis() + 5_000;
        while (System.currentTimeMillis() < deadline) {
            QueryExportTaskResponse task = targetService.getTask(taskId);
            if (!"PENDING".equals(task.status()) && !"RUNNING".equals(task.status())) {
                return task;
            }
            try {
                Thread.sleep(20);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new AssertionError("等待导出任务结束时被中断", e);
            }
        }
        throw new AssertionError("导出任务未在超时时间内进入终态");
    }

    private static QueryExportServiceImpl.ExportTask task(QueryExportServiceImpl.ExportTaskStatus status, Instant updatedAt) {
        return new QueryExportServiceImpl.ExportTask(
                "t", 1L, 10L, 1L, "csv", status, null, null, 100, false, null, null, updatedAt, updatedAt);
    }
}
