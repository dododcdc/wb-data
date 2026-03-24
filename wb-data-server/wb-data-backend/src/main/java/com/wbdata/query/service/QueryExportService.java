package com.wbdata.query.service;

import com.wbdata.query.dto.QueryExportTaskResponse;
import org.springframework.core.io.Resource;

import java.util.List;

public interface QueryExportService {
    QueryExportTaskResponse createExportTask(Long dataSourceId, String sql, String database, String format);

    List<QueryExportTaskResponse> listTasks();

    QueryExportTaskResponse getTask(String taskId);

    Resource getDownloadResource(String taskId);

    String getDownloadFileName(String taskId);
}
