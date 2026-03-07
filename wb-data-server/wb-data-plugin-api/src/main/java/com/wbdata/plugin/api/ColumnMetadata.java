package com.wbdata.plugin.api;

public record ColumnMetadata(
    String name,
    String type,
    int size,
    boolean nullable,
    String remarks,
    boolean primaryKey
) {}
