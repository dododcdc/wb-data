package com.wbdata.plugin.api;

import java.util.List;

public record DataSourcePluginDescriptor(
        String type,
        String label,
        int order,
        String helperText,
        boolean supportsConnectionTest,
        List<PluginFieldDescriptor> fields
) {
    public DataSourcePluginDescriptor {
        helperText = helperText == null ? "" : helperText;
        fields = fields == null ? List.of() : List.copyOf(fields);
    }
}
