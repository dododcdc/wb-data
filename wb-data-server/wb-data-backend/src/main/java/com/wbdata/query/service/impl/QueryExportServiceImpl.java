package com.wbdata.query.service.impl;

import com.wbdata.plugin.api.QueryResult;
import com.wbdata.query.dto.QueryExportTaskResponse;
import com.wbdata.query.service.QueryExportService;
import com.wbdata.query.service.QueryService;
import jakarta.annotation.PreDestroy;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.xssf.streaming.SXSSFSheet;
import org.apache.poi.xssf.streaming.SXSSFWorkbook;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Service;

import java.io.BufferedWriter;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@Service
public class QueryExportServiceImpl implements QueryExportService {
    private static final int EXPORT_ROW_LIMIT = 100_000;
    private static final int MAX_VISIBLE_TASKS = 20;

    private final QueryService queryService;
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
    private final Map<String, ExportTask> tasks = new ConcurrentHashMap<>();

    public QueryExportServiceImpl(QueryService queryService) {
        this.queryService = queryService;
    }

    @Override
    public QueryExportTaskResponse createExportTask(Long dataSourceId, String sql, String database, String format) {
        String normalizedFormat = normalizeFormat(format);
        String taskId = UUID.randomUUID().toString();
        Instant now = Instant.now();
        ExportTask task = new ExportTask(taskId, normalizedFormat, ExportTaskStatus.PENDING, null, null, EXPORT_ROW_LIMIT, false, null, null, now, now);
        tasks.put(taskId, task);

        executor.submit(() -> runExport(taskId, dataSourceId, sql, database, normalizedFormat));
        return toResponse(task);
    }

    @Override
    public List<QueryExportTaskResponse> listTasks() {
        return tasks.values().stream()
                .sorted(Comparator.comparing(ExportTask::updatedAt).reversed())
                .limit(MAX_VISIBLE_TASKS)
                .map(this::toResponse)
                .toList();
    }

    @Override
    public QueryExportTaskResponse getTask(String taskId) {
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

    private void runExport(String taskId, Long dataSourceId, String sql, String database, String format) {
        updateTask(taskId, task -> task.withStatus(ExportTaskStatus.RUNNING).withUpdatedAt(Instant.now()).withErrorMessage(null));
        try {
            QueryResult result = queryService.executeQuery(dataSourceId, sql, database, EXPORT_ROW_LIMIT);
            Path filePath = writeExportFile(taskId, format, result);
            String fileName = "query-export-" + taskId + "." + format;
            updateTask(taskId, task -> task
                    .withStatus(ExportTaskStatus.SUCCESS)
                    .withFilePath(filePath)
                    .withFileName(fileName)
                    .withExportedRows(result.rows().size())
                    .withTruncated(result.truncated())
                    .withUpdatedAt(Instant.now()));
        } catch (Exception e) {
            updateTask(taskId, task -> task
                    .withStatus(ExportTaskStatus.FAILED)
                    .withErrorMessage(e.getMessage() == null || e.getMessage().isBlank() ? "导出失败，请稍后重试。" : e.getMessage())
                    .withUpdatedAt(Instant.now()));
        }
    }

    private Path writeExportFile(String taskId, String format, QueryResult result) throws IOException {
        return switch (normalizeFormat(format)) {
            case "csv" -> writeCsvFile(taskId, result);
            case "xlsx" -> writeXlsxFile(taskId, result);
            default -> throw new IllegalArgumentException("不支持的导出格式: " + format);
        };
    }

    private Path writeCsvFile(String taskId, QueryResult result) throws IOException {
        Path filePath = Files.createTempFile("wb-query-export-" + taskId + "-", ".csv");
        try (BufferedWriter writer = Files.newBufferedWriter(filePath, StandardCharsets.UTF_8)) {
            writer.write('\uFEFF');
            if (!result.columns().isEmpty()) {
                writer.write(String.join(",", result.columns().stream().map(column -> escapeCsv(column.name())).toList()));
                writer.newLine();
            }

            for (Map<String, Object> row : result.rows()) {
                List<String> values = new ArrayList<>();
                result.columns().forEach(column -> values.add(escapeCsv(String.valueOf(row.getOrDefault(column.name(), "")))));
                writer.write(String.join(",", values));
                writer.newLine();
            }
        }
        return filePath;
    }

    private Path writeXlsxFile(String taskId, QueryResult result) throws IOException {
        Path filePath = Files.createTempFile("wb-query-export-" + taskId + "-", ".xlsx");
        try (SXSSFWorkbook workbook = new SXSSFWorkbook(500);
             OutputStream outputStream = Files.newOutputStream(filePath)) {
            workbook.setCompressTempFiles(true);
            SXSSFSheet sheet = workbook.createSheet("Result");

            int rowIndex = 0;
            if (!result.columns().isEmpty()) {
                Row headerRow = sheet.createRow(rowIndex++);
                for (int columnIndex = 0; columnIndex < result.columns().size(); columnIndex++) {
                    Cell cell = headerRow.createCell(columnIndex);
                    cell.setCellValue(result.columns().get(columnIndex).name());
                }
            }

            for (Map<String, Object> rowData : result.rows()) {
                Row dataRow = sheet.createRow(rowIndex++);
                for (int columnIndex = 0; columnIndex < result.columns().size(); columnIndex++) {
                    String columnName = result.columns().get(columnIndex).name();
                    Cell cell = dataRow.createCell(columnIndex);
                    Object value = rowData.get(columnName);
                    cell.setCellValue(value == null ? "" : String.valueOf(value));
                }
            }

            workbook.write(outputStream);
            workbook.dispose();
        }
        return filePath;
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

    private ExportTask requireTask(String taskId) {
        ExportTask task = tasks.get(taskId);
        if (task == null) {
            throw new IllegalArgumentException("导出任务不存在: " + taskId);
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
    }

    private enum ExportTaskStatus {
        PENDING,
        RUNNING,
        SUCCESS,
        FAILED
    }

    private record ExportTask(
            String taskId,
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
            return new ExportTask(taskId, format, nextStatus, filePath, fileName, rowLimit, truncated, exportedRows, errorMessage, createdAt, updatedAt);
        }

        ExportTask withFilePath(Path nextFilePath) {
            return new ExportTask(taskId, format, status, nextFilePath, fileName, rowLimit, truncated, exportedRows, errorMessage, createdAt, updatedAt);
        }

        ExportTask withFileName(String nextFileName) {
            return new ExportTask(taskId, format, status, filePath, nextFileName, rowLimit, truncated, exportedRows, errorMessage, createdAt, updatedAt);
        }

        ExportTask withExportedRows(Integer nextExportedRows) {
            return new ExportTask(taskId, format, status, filePath, fileName, rowLimit, truncated, nextExportedRows, errorMessage, createdAt, updatedAt);
        }

        ExportTask withTruncated(boolean nextTruncated) {
            return new ExportTask(taskId, format, status, filePath, fileName, rowLimit, nextTruncated, exportedRows, errorMessage, createdAt, updatedAt);
        }

        ExportTask withErrorMessage(String nextErrorMessage) {
            return new ExportTask(taskId, format, status, filePath, fileName, rowLimit, truncated, exportedRows, nextErrorMessage, createdAt, updatedAt);
        }

        ExportTask withUpdatedAt(Instant nextUpdatedAt) {
            return new ExportTask(taskId, format, status, filePath, fileName, rowLimit, truncated, exportedRows, errorMessage, createdAt, nextUpdatedAt);
        }
    }
}
