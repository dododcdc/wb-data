package com.wbdata.query.service.impl;

import com.wbdata.auth.context.AuthContext;
import com.wbdata.auth.enums.Permission;
import com.wbdata.datasource.service.AuthorizedDataSourceService;
import com.wbdata.datasource.entity.DataSource;
import com.wbdata.plugin.api.ColumnMetadata;
import com.wbdata.plugin.api.QueryRowHandler;
import com.wbdata.plugin.api.QueryStreamSummary;
import com.wbdata.query.dto.QueryExportTaskResponse;
import com.wbdata.query.service.QueryExportService;
import com.wbdata.query.service.QueryService;
import jakarta.annotation.PreDestroy;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.xssf.streaming.SXSSFSheet;
import org.apache.poi.xssf.streaming.SXSSFWorkbook;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.io.BufferedWriter;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;

@Service
public class QueryExportServiceImpl implements QueryExportService {
    private static final int EXPORT_ROW_LIMIT = 100_000;
    private static final int MAX_CONCURRENT_EXPORTS = 4;
    private static final int MAX_IN_FLIGHT_EXPORTS = 16;
    private static final int MAX_VISIBLE_TASKS = 20;
    private static final Duration TASK_TTL = Duration.ofHours(1);

    private final QueryService queryService;
    private final AuthorizedDataSourceService authorizedDataSourceService;
    private final int maxInFlightExports;
    private final Semaphore exportPermits;
    private final AtomicInteger inFlightExports = new AtomicInteger(0);
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
    private final Map<String, ExportTask> tasks = new ConcurrentHashMap<>();

    @Autowired
    public QueryExportServiceImpl(QueryService queryService, AuthorizedDataSourceService authorizedDataSourceService) {
        this(queryService, authorizedDataSourceService, MAX_CONCURRENT_EXPORTS, MAX_IN_FLIGHT_EXPORTS);
    }

    QueryExportServiceImpl(QueryService queryService,
                           AuthorizedDataSourceService authorizedDataSourceService,
                           int maxConcurrentExports,
                           int maxInFlightExports) {
        this.queryService = queryService;
        this.authorizedDataSourceService = authorizedDataSourceService;
        this.maxInFlightExports = maxInFlightExports;
        this.exportPermits = new Semaphore(maxConcurrentExports);
    }

    @Override
    public QueryExportTaskResponse createExportTask(Long dataSourceId, String sql, String database, String format) {
        Long ownerId = AuthContext.require().id();
        DataSource dataSource = authorizedDataSourceService.requireEnabledDataSource(dataSourceId, Permission.QUERY_EXPORT);
        evictExpiredTasks();
        String normalizedFormat = normalizeFormat(format);
        if (!"csv".equals(normalizedFormat) && !"xlsx".equals(normalizedFormat)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "不支持的导出格式: " + format);
        }
        if (!tryAcquireInFlightSlot()) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "当前导出任务过多，请稍后重试");
        }

        String taskId = UUID.randomUUID().toString();
        Instant now = Instant.now();
        ExportTask task = new ExportTask(taskId, ownerId, dataSource.getGroupId(), dataSource.getId(),
                normalizedFormat, ExportTaskStatus.PENDING, null, null, EXPORT_ROW_LIMIT, false, null, null, now, now);
        tasks.put(taskId, task);

        try {
            executor.submit(() -> runExport(taskId, task.dataSourceId(), sql, database, normalizedFormat));
        } catch (RuntimeException | Error submissionFailure) {
            tasks.remove(taskId);
            inFlightExports.decrementAndGet();
            throw submissionFailure;
        }
        return toResponse(task);
    }

    @Override
    public List<QueryExportTaskResponse> listTasks() {
        Long ownerId = AuthContext.require().id();
        evictExpiredTasks();
        return tasks.values().stream()
                .filter(task -> Objects.equals(task.ownerId(), ownerId))
                .sorted(Comparator.comparing(ExportTask::updatedAt).reversed())
                .limit(MAX_VISIBLE_TASKS)
                .map(this::toResponse)
                .toList();
    }

    @Override
    public QueryExportTaskResponse getTask(String taskId) {
        evictExpiredTasks();
        return toResponse(requireTask(taskId));
    }

    @Override
    public Resource getDownloadResource(String taskId) {
        ExportTask task = requireTask(taskId);
        if (task.status() != ExportTaskStatus.SUCCESS || task.filePath() == null) {
            throw new IllegalStateException("导出文件尚未准备完成");
        }

        return new FileSystemResource(task.filePath());
    }

    @Override
    public String getDownloadFileName(String taskId) {
        ExportTask task = requireTask(taskId);
        if (task.fileName() == null || task.fileName().isBlank()) {
            throw new IllegalStateException("导出文件尚未准备完成");
        }
        return task.fileName();
    }

    private boolean tryAcquireInFlightSlot() {
        while (true) {
            int current = inFlightExports.get();
            if (current >= maxInFlightExports) {
                return false;
            }
            if (inFlightExports.compareAndSet(current, current + 1)) {
                return true;
            }
        }
    }

    private void runExport(String taskId, Long dataSourceId, String sql, String database, String format) {
        boolean permitAcquired = false;
        Path filePath = null;
        try {
            exportPermits.acquire();
            permitAcquired = true;
            updateTask(taskId, task -> task.withStatus(ExportTaskStatus.RUNNING).withUpdatedAt(Instant.now()).withErrorMessage(null));
            String normalized = normalizeFormat(format);
            filePath = switch (normalized) {
                case "csv" -> Files.createTempFile("wb-query-export-" + taskId + "-", ".csv");
                case "xlsx" -> Files.createTempFile("wb-query-export-" + taskId + "-", ".xlsx");
                default -> throw new IllegalArgumentException("不支持的导出格式: " + format);
            };
            QueryStreamSummary summary = streamExportFile(dataSourceId, sql, database, normalized, filePath);
            String fileName = "query-export-" + taskId + "." + normalized;
            Path completedPath = filePath;
            filePath = null;
            updateTask(taskId, task -> task
                    .withStatus(ExportTaskStatus.SUCCESS)
                    .withFilePath(completedPath)
                    .withFileName(fileName)
                    .withExportedRows(summary.rowCount())
                    .withTruncated(summary.truncated())
                    .withUpdatedAt(Instant.now()));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            deleteQuietly(filePath);
            updateTask(taskId, task -> task
                    .withStatus(ExportTaskStatus.FAILED)
                    .withErrorMessage("导出任务已中断")
                    .withUpdatedAt(Instant.now()));
        } catch (Exception e) {
            deleteQuietly(filePath);
            updateTask(taskId, task -> task
                    .withStatus(ExportTaskStatus.FAILED)
                    .withErrorMessage(e.getMessage() == null || e.getMessage().isBlank() ? "导出失败，请稍后重试。" : e.getMessage())
                    .withUpdatedAt(Instant.now()));
        } finally {
            if (permitAcquired) {
                exportPermits.release();
            }
            inFlightExports.decrementAndGet();
        }
    }

    private QueryStreamSummary streamExportFile(Long dataSourceId,
                                                String sql,
                                                String database,
                                                String normalizedFormat,
                                                Path filePath) throws IOException {
        return switch (normalizedFormat) {
            case "csv" -> streamCsvFile(dataSourceId, sql, database, filePath);
            case "xlsx" -> streamXlsxFile(dataSourceId, sql, database, filePath);
            default -> throw new IllegalArgumentException("不支持的导出格式: " + normalizedFormat);
        };
    }

    private QueryStreamSummary streamCsvFile(Long dataSourceId, String sql, String database, Path filePath) throws IOException {
        try (BufferedWriter writer = Files.newBufferedWriter(filePath, StandardCharsets.UTF_8)) {
            writer.write('\uFEFF');
            return queryService.streamQuery(dataSourceId, sql, database, EXPORT_ROW_LIMIT, new QueryRowHandler() {
                @Override
                public void onColumns(List<ColumnMetadata> columns) throws IOException {
                    if (!columns.isEmpty()) {
                        writer.write(columns.stream().map(column -> escapeCsv(column.name())).collect(Collectors.joining(",")));
                        writer.newLine();
                    }
                }

                @Override
                public void onRow(List<Object> values) throws IOException {
                    List<String> formatted = new ArrayList<>(values.size());
                    for (Object value : values) {
                        formatted.add(escapeCsv(value == null ? "" : String.valueOf(value)));
                    }
                    writer.write(String.join(",", formatted));
                    writer.newLine();
                }
            });
        }
    }

    private QueryStreamSummary streamXlsxFile(Long dataSourceId, String sql, String database, Path filePath) throws IOException {
        try (SXSSFWorkbook workbook = new SXSSFWorkbook(500);
             OutputStream outputStream = Files.newOutputStream(filePath)) {
            try {
                workbook.setCompressTempFiles(true);
                SXSSFSheet sheet = workbook.createSheet("Result");
                int[] rowIndex = {0};

                QueryStreamSummary summary = queryService.streamQuery(
                        dataSourceId,
                        sql,
                        database,
                        EXPORT_ROW_LIMIT,
                        new QueryRowHandler() {
                            @Override
                            public void onColumns(List<ColumnMetadata> columns) {
                                if (!columns.isEmpty()) {
                                    Row headerRow = sheet.createRow(rowIndex[0]++);
                                    for (int columnIndex = 0; columnIndex < columns.size(); columnIndex++) {
                                        headerRow.createCell(columnIndex).setCellValue(columns.get(columnIndex).name());
                                    }
                                }
                            }

                            @Override
                            public void onRow(List<Object> values) {
                                Row dataRow = sheet.createRow(rowIndex[0]++);
                                for (int columnIndex = 0; columnIndex < values.size(); columnIndex++) {
                                    Object value = values.get(columnIndex);
                                    dataRow.createCell(columnIndex).setCellValue(value == null ? "" : String.valueOf(value));
                                }
                            }
                        });

                workbook.write(outputStream);
                return summary;
            } finally {
                workbook.dispose();
            }
        }
    }

    private String escapeCsv(String value) {
        boolean shouldQuote = value.contains(",") || value.contains("\n") || value.contains("\"");
        String escaped = value.replace("\"", "\"\"");
        return shouldQuote ? "\"" + escaped + "\"" : escaped;
    }

    private String normalizeFormat(String format) {
        if (format == null || format.isBlank()) {
            return "csv";
        }
        return format.toLowerCase();
    }

    private void evictExpiredTasks() {
        Instant now = Instant.now();
        tasks.values().removeIf(task -> {
            if (!isExpired(task, now)) {
                return false;
            }
            deleteQuietly(task.filePath());
            return true;
        });
    }

    static boolean isExpired(ExportTask task, Instant now) {
        boolean terminal = task.status() == ExportTaskStatus.SUCCESS || task.status() == ExportTaskStatus.FAILED;
        return terminal && task.updatedAt().plus(TASK_TTL).isBefore(now);
    }

    private static void deleteQuietly(Path path) {
        if (path == null) {
            return;
        }
        try {
            Files.deleteIfExists(path);
        } catch (IOException ignored) {
            // 临时文件清理失败不影响主流程，交由操作系统临时目录策略兜底
        }
    }

    private ExportTask requireTask(String taskId) {
        Long ownerId = AuthContext.require().id();
        ExportTask task = tasks.get(taskId);
        if (task == null || !Objects.equals(task.ownerId(), ownerId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "导出任务不存在");
        }
        DataSource dataSource = authorizedDataSourceService.requireDataSource(task.dataSourceId(), Permission.QUERY_EXPORT);
        if (!Objects.equals(task.groupId(), dataSource.getGroupId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "数据源所属项目组已变更，请重新导出");
        }
        return task;
    }

    private void updateTask(String taskId, java.util.function.UnaryOperator<ExportTask> updater) {
        tasks.compute(taskId, (_id, current) -> current == null ? null : updater.apply(current));
    }

    private QueryExportTaskResponse toResponse(ExportTask task) {
        return new QueryExportTaskResponse(
                task.taskId(),
                task.format(),
                task.status().name(),
                task.fileName(),
                task.exportedRows(),
                task.rowLimit(),
                task.truncated(),
                task.errorMessage(),
                task.createdAt(),
                task.updatedAt());
    }

    @PreDestroy
    void shutdown() {
        executor.shutdownNow();
        tasks.values().forEach(task -> deleteQuietly(task.filePath()));
        tasks.clear();
    }

    enum ExportTaskStatus {
        PENDING,
        RUNNING,
        SUCCESS,
        FAILED
    }

    record ExportTask(
            String taskId,
            Long ownerId,
            Long groupId,
            Long dataSourceId,
            String format,
            ExportTaskStatus status,
            Path filePath,
            String fileName,
            Integer rowLimit,
            boolean truncated,
            Integer exportedRows,
            String errorMessage,
            Instant createdAt,
            Instant updatedAt
    ) {
        ExportTask withStatus(ExportTaskStatus nextStatus) {
            return new ExportTask(taskId, ownerId, groupId, dataSourceId, format, nextStatus, filePath, fileName, rowLimit, truncated, exportedRows, errorMessage, createdAt, updatedAt);
        }

        ExportTask withFilePath(Path nextFilePath) {
            return new ExportTask(taskId, ownerId, groupId, dataSourceId, format, status, nextFilePath, fileName, rowLimit, truncated, exportedRows, errorMessage, createdAt, updatedAt);
        }

        ExportTask withFileName(String nextFileName) {
            return new ExportTask(taskId, ownerId, groupId, dataSourceId, format, status, filePath, nextFileName, rowLimit, truncated, exportedRows, errorMessage, createdAt, updatedAt);
        }

        ExportTask withExportedRows(Integer nextExportedRows) {
            return new ExportTask(taskId, ownerId, groupId, dataSourceId, format, status, filePath, fileName, rowLimit, truncated, nextExportedRows, errorMessage, createdAt, updatedAt);
        }

        ExportTask withTruncated(boolean nextTruncated) {
            return new ExportTask(taskId, ownerId, groupId, dataSourceId, format, status, filePath, fileName, rowLimit, nextTruncated, exportedRows, errorMessage, createdAt, updatedAt);
        }

        ExportTask withErrorMessage(String nextErrorMessage) {
            return new ExportTask(taskId, ownerId, groupId, dataSourceId, format, status, filePath, fileName, rowLimit, truncated, exportedRows, nextErrorMessage, createdAt, updatedAt);
        }

        ExportTask withUpdatedAt(Instant nextUpdatedAt) {
            return new ExportTask(taskId, ownerId, groupId, dataSourceId, format, status, filePath, fileName, rowLimit, truncated, exportedRows, errorMessage, createdAt, nextUpdatedAt);
        }
    }
}
