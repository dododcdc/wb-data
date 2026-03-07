package com.wbdata.plugin.api;

import java.util.List;
import java.util.Map;

public record QueryResult(
    List<ColumnMetadata> columns,
    List<Map<String, Object>> rows,
    long executionTimeMs,
    String message
) {}
