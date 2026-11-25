package com.wbdata.operations.service;

import com.wbdata.offline.kestra.KestraExecutionSnapshot;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * 人工置成功状态判定与 Kestra 执行标签辅助工具。
 */
public final class OperationsForceSuccess {

    public static final String STATUS_FORCE_SUCCESS = "FORCE_SUCCESS";
    public static final String LABEL_FORCE_SUCCESS = "wbdataForceSuccess";
    public static final String LABEL_FORCE_SUCCESS_BY = "wbdataForceSuccessBy";
    public static final String LABEL_FORCE_SUCCESS_AT = "wbdataForceSuccessAt";

    private OperationsForceSuccess() {
    }

    public static boolean isForceSuccess(KestraExecutionSnapshot execution) {
        if (execution == null || execution.status() == null) {
            return false;
        }
        if (!"SUCCESS".equalsIgnoreCase(execution.status())) {
            return false;
        }
        Map<String, String> labels = execution.labels();
        return labels != null && "true".equalsIgnoreCase(labels.get(LABEL_FORCE_SUCCESS));
    }

    public static String effectiveStatus(KestraExecutionSnapshot execution) {
        if (execution == null) {
            return null;
        }
        return isForceSuccess(execution) ? STATUS_FORCE_SUCCESS : execution.status();
    }

    public static boolean canMarkSuccess(String status) {
        if (status == null) {
            return false;
        }
        String normalized = status.toUpperCase(Locale.ROOT);
        return "FAILED".equals(normalized)
                || "KILLED".equals(normalized)
                || "CANCELLED".equals(normalized);
    }

    public static String forceSuccessBy(KestraExecutionSnapshot execution) {
        if (!isForceSuccess(execution) || execution.labels() == null) {
            return null;
        }
        String operator = execution.labels().get(LABEL_FORCE_SUCCESS_BY);
        return operator == null || operator.isBlank() ? null : operator.trim();
    }

    public static Instant forceSuccessAt(KestraExecutionSnapshot execution) {
        if (!isForceSuccess(execution) || execution.labels() == null) {
            return null;
        }
        String raw = execution.labels().get(LABEL_FORCE_SUCCESS_AT);
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String trimmed = raw.trim();
        try {
            return Instant.ofEpochMilli(Long.parseLong(trimmed));
        } catch (NumberFormatException ignored) {
            try {
                return Instant.parse(trimmed);
            } catch (RuntimeException ex) {
                return null;
            }
        }
    }

    public static Map<String, String> buildMergedLabels(Map<String, String> existingLabels,
                                                        String operatorName,
                                                        Instant markedAt) {
        Map<String, String> merged = new LinkedHashMap<>();
        if (existingLabels != null) {
            existingLabels.forEach((key, value) -> {
                if (key != null && !key.isBlank() && !key.startsWith("system.")
                        && value != null && !value.isBlank()) {
                    merged.put(key, value);
                }
            });
        }
        merged.put(LABEL_FORCE_SUCCESS, "true");
        if (operatorName != null && !operatorName.isBlank()) {
            merged.put(LABEL_FORCE_SUCCESS_BY, operatorName.trim());
        }
        Instant timestamp = markedAt == null ? Instant.now() : markedAt;
        merged.put(LABEL_FORCE_SUCCESS_AT, String.valueOf(timestamp.toEpochMilli()));
        return Map.copyOf(merged);
    }
}
