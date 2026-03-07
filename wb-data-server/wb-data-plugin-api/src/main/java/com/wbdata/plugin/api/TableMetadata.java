package com.wbdata.plugin.api;

import java.util.List;

public record TableMetadata(
    String name,
    String type,
    String remarks,
    List<ColumnMetadata> columns
) {}
