package com.wbdata.plugin.api;

import java.util.List;

public record DialectMetadata(
        List<String> keywords,
        List<FunctionMetadata> functions,
        List<String> dataTypes) {
    public DialectMetadata {
        keywords = keywords == null ? List.of() : List.copyOf(keywords);
        functions = functions == null ? List.of() : List.copyOf(functions);
        dataTypes = dataTypes == null ? List.of() : List.copyOf(dataTypes);
    }
}
