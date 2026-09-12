package com.wbdata.query.service.impl;

import com.wbdata.plugin.api.ColumnMetadata;
import com.wbdata.plugin.api.QueryResult;
import com.wbdata.query.dto.QueryExportTaskResponse;
import com.wbdata.query.service.QueryService;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.core.io.Resource;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

class QueryExportServiceImplTest {

    private final QueryService queryService = Mockito.mock(QueryService.class);
    private final QueryExportServiceImpl service = new QueryExportServiceImpl(queryService);

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
    void unknownTaskThrows() {
        assertThatThrownBy(() -> service.getTask("missing"))
                .isInstanceOf(IllegalArgumentException.class);
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
                "t", "csv", status, null, null, 100, false, null, null, updatedAt, updatedAt);
    }
}
