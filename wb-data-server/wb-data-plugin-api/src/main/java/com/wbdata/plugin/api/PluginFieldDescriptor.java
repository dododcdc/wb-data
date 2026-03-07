package com.wbdata.plugin.api;

public record PluginFieldDescriptor(
        String key,
        String section,
        String label,
        String placeholder,
        String inputType,
        boolean required,
        String defaultValue
) {
}
