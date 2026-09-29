package com.wbdata.offline.service;

import org.yaml.snakeyaml.Yaml;

import java.util.List;
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

    /** 判断 flow YAML 是否声明了某个 input（未声明的 input 传入会被 Kestra 丢弃并告警）。 */
    public static boolean declaresInput(String flowSource, String inputId) {
        if (flowSource == null || flowSource.isBlank() || inputId == null || inputId.isBlank()) {
            return false;
        }
        Object loaded = new Yaml().load(flowSource);
        if (!(loaded instanceof Map<?, ?> root) || !(root.get("inputs") instanceof List<?> inputs)) {
            return false;
        }
        for (Object input : inputs) {
            if (input instanceof Map<?, ?> inputMap && inputId.equals(inputMap.get("id"))) {
                return true;
            }
        }
        return false;
    }
}
