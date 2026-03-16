package com.wbdata.query.service;

import com.wbdata.plugin.api.ColumnMetadata;
import com.wbdata.plugin.api.PageResult;
import com.wbdata.plugin.api.TableSummary;
import java.util.List;

public interface MetadataService {
    List<String> getDatabases(Long dataSourceId);

    PageResult<TableSummary> getTables(Long dataSourceId, String databaseName, String keyword, int page, int size);

    List<ColumnMetadata> getColumns(Long dataSourceId, String databaseName, String tableName);

    com.wbdata.plugin.api.DialectMetadata getDialectMetadata(Long dataSourceId);
}
