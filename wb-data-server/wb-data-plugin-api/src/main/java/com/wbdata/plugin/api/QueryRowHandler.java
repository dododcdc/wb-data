package com.wbdata.plugin.api;

import java.util.List;

/**
 * Callback interface for consuming JDBC query columns and rows incrementally
 * without materializing the full result set in memory.
 */
public interface QueryRowHandler {

    void onColumns(List<ColumnMetadata> columns) throws Exception;

    void onRow(List<Object> values) throws Exception;
}
