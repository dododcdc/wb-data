package com.wbdata.query.service.impl;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.wbdata.auth.context.AuthContext;
import com.wbdata.auth.service.AuthSession;
import com.wbdata.auth.service.AuthorizedDataSourceService;
import com.wbdata.auth.service.GroupAuthorizationService;
import com.wbdata.auth.service.PermissionService;
import com.wbdata.datasource.entity.DataSource;
import com.wbdata.datasource.service.DataSourceService;
import com.wbdata.group.entity.WbProjectGroup;
import com.wbdata.group.entity.WbProjectGroupMember;
import com.wbdata.group.mapper.WbProjectGroupMapper;
import com.wbdata.group.mapper.WbProjectGroupMemberMapper;
import com.wbdata.plugin.api.ColumnMetadata;
import com.wbdata.plugin.api.QueryResult;
import com.wbdata.query.dto.QueryExportTaskResponse;
import com.wbdata.query.service.QueryService;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.Mockito;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assertions.assertAll;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class QueryExportServiceImplTest {

    private final QueryService queryService = Mockito.mock(QueryService.class);
    private final DataSourceService dataSourceService = Mockito.mock(DataSourceService.class);
    private final WbProjectGroupMapper groupMapper = Mockito.mock(WbProjectGroupMapper.class);
    private final WbProjectGroupMemberMapper memberMapper = Mockito.mock(WbProjectGroupMemberMapper.class);
    private final GroupAuthorizationService authorizationService = new GroupAuthorizationService(
            groupMapper, memberMapper, new PermissionService());
    private final AuthorizedDataSourceService authorizedDataSourceService = new AuthorizedDataSourceService(
            dataSourceService, authorizationService);
    private final QueryExportServiceImpl service = new QueryExportServiceImpl(queryService, authorizedDataSourceService);
    private final DataSource dataSource = new DataSource();
    private final List<WbProjectGroupMember> memberships = new ArrayList<>();

    @BeforeAll
    static void initializeMapperMetadata() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""),
                WbProjectGroupMember.class);
    }

    @BeforeEach
    void loginOwner() {
        login(1L, "USER");
        dataSource.setId(1L);
        dataSource.setGroupId(10L);
        when(dataSourceService.getById(1L)).thenReturn(dataSource);
        List<WbProjectGroup> groups = List.of(group(10L), group(20L));
        for (long userId : List.of(1L, 2L)) {
            for (WbProjectGroup group : groups) {
                WbProjectGroupMember member = new WbProjectGroupMember();
                member.setUserId(userId);
                member.setGroupId(group.getId());
                member.setRole("DEVELOPER");
                memberships.add(member);
            }
        }
        when(memberMapper.selectOne(any())).thenAnswer(invocation -> {
            LambdaQueryWrapper<WbProjectGroupMember> query = invocation.getArgument(0);
            query.getSqlSegment();
            Map<String, Object> parameters = query.getParamNameValuePairs();
            return memberships.stream()
                    .filter(member -> parameters.containsValue(member.getUserId())
                            && parameters.containsValue(member.getGroupId()))
                    .findFirst().orElse(null);
        });
        when(groupMapper.selectById(any())).thenAnswer(invocation -> groups.stream()
                .filter(group -> group.getId().equals(invocation.getArgument(0)))
                .findFirst().orElse(null));
    }

    private static WbProjectGroup group(Long groupId) {
        WbProjectGroup group = new WbProjectGroup();
        group.setId(groupId);
        group.setName("group-" + groupId);
        group.setStatus("active");
        return group;
    }

    private void revokeMembership(Long userId) {
        memberships.removeIf(member -> member.getUserId().equals(userId) && member.getGroupId().equals(10L));
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
        when(queryService.executeQuery(1L, "select 1", "db", 100_000)).thenAnswer(invocation -> {
            workerSession.set(AuthContext.current());
            started.countDown();
            if (!release.await(5, TimeUnit.SECONDS)) {
                throw new IllegalStateException("等待测试释放 worker 超时");
            }
            return new QueryResult(List.of(), List.of(), 1L, "OK", false, 100_000);
        });

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
        when(queryService.executeQuery(anyLong(), anyString(), anyString(), anyInt()))
                .thenReturn(new QueryResult(List.of(), List.of(), 1L, "OK", false, 100));
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
        QueryResult result = new QueryResult(
                List.of(new ColumnMetadata("id", "INT", 11, false, "", true)),
                List.of(Map.of("id", 1)),
                1L, "OK", false, 100);
        when(queryService.executeQuery(anyLong(), anyString(), anyString(), anyInt())).thenReturn(result);

        QueryExportTaskResponse created = service.createExportTask(1L, "select 1", "db", "csv");
        QueryExportTaskResponse finished = awaitTerminal(created.taskId());

        assertThat(finished.status()).isEqualTo("SUCCESS");
        assertThat(finished.exportedRows()).isEqualTo(1);
        Resource resource = service.getDownloadResource(created.taskId());
        assertThat(resource.exists()).isTrue();
        Path exported = resource.getFile().toPath();
        assertThat(Files.readString(exported)).contains("id");

        service.shutdown();
        assertThat(Files.exists(exported)).isFalse();
    }

    @Test
    void exportFailureMarksTaskFailedAndBlocksDownload() {
        when(queryService.executeQuery(anyLong(), anyString(), anyString(), anyInt()))
                .thenThrow(new RuntimeException("connection refused"));

        QueryExportTaskResponse created = service.createExportTask(1L, "select 1", "db", "csv");
        QueryExportTaskResponse finished = awaitTerminal(created.taskId());

        assertThat(finished.status()).isEqualTo("FAILED");
        assertThat(finished.errorMessage()).contains("connection refused");
        assertThatThrownBy(() -> service.getDownloadResource(created.taskId()))
                .isInstanceOf(IllegalStateException.class);
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
        long deadline = System.currentTimeMillis() + 5_000;
        while (System.currentTimeMillis() < deadline) {
            QueryExportTaskResponse task = service.getTask(taskId);
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
