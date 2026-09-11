package com.wbdata.offline.service;

import org.yaml.snakeyaml.Yaml;

import java.util.Map;

public final class FlowParameterMetadata {

    private FlowParameterMetadata() {
    }

    public static String readSnapshotId(String flowSource) {
        if (flowSource == null || flowSource.isBlank()) {
            return null;
        }
        Object loaded = new Yaml().load(flowSource);
        if (!(loaded instanceof Map<?, ?> root) || !(root.get("labels") instanceof Map<?, ?> labels)) {
            return null;
        }
        Object value = labels.get(ExecutionParameterSnapshotRegistry.LABEL_KEY);
        return value == null ? null : value.toString();
    }
}
