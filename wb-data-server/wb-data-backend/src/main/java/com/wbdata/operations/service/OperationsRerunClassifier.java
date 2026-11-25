package com.wbdata.operations.service;

import com.wbdata.offline.kestra.KestraExecutionSnapshot;
import com.wbdata.offline.service.OfflineFlowInspector;

import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

/**
 * 统一判定执行记录的重跑/重试来源与部分重跑范围：
 * 区分无重跑、手动重跑与 Kestra 自动重试，并提取部分重跑节点计数。
 */
final class OperationsRerunClassifier {

    static final String NONE = "NONE";
    static final String MANUAL = "MANUAL";
    static final String AUTO = "AUTO";
    static final String RERUN_SELECTED_COUNT_LABEL = "wbdataRerunSelectedCount";
    static final String RERUN_TOTAL_COUNT_LABEL = "wbdataRerunTotalCount";

    private OperationsRerunClassifier() {
    }

    static Classification classify(KestraExecutionSnapshot execution, Set<String> manualRerunIds) {
        if (execution == null) {
            return new Classification(false, NONE, null, false, null, null);
        }
        PartialMeta partial = resolvePartialMeta(execution);
        if (manualRerunIds != null && manualRerunIds.contains(execution.id())) {
            return new Classification(true, MANUAL, null,
                    partial.partial(), partial.selectedCount(), partial.totalCount());
        }
        if (isAutoRetry(execution)) {
            Integer attemptNumber = execution.attemptNumber();
            Integer retryAttempt = attemptNumber != null && attemptNumber > 1 ? attemptNumber - 1 : null;
            return new Classification(true, AUTO, retryAttempt,
                    partial.partial(), partial.selectedCount(), partial.totalCount());
        }
        return new Classification(false, NONE, null,
                partial.partial(), partial.selectedCount(), partial.totalCount());
    }

    private static PartialMeta resolvePartialMeta(KestraExecutionSnapshot execution) {
        Map<String, String> labels = execution.labels() == null ? Map.of() : execution.labels();
        Integer selectedCount = parsePositiveInt(labels.get(RERUN_SELECTED_COUNT_LABEL));
        Integer totalCount = parsePositiveInt(labels.get(RERUN_TOTAL_COUNT_LABEL));

        if (selectedCount == null && execution.inputs() != null) {
            String rerunTasks = execution.inputs().get(OfflineFlowInspector.RERUN_TASKS_INPUT);
            if (rerunTasks != null && !rerunTasks.isBlank()) {
                Set<String> tokens = new LinkedHashSet<>();
                Arrays.stream(rerunTasks.split(","))
                        .map(String::trim)
                        .filter(token -> !token.isEmpty())
                        .forEach(tokens::add);
                if (!tokens.isEmpty()) {
                    selectedCount = tokens.size();
                }
            }
        }

        if (selectedCount == null || selectedCount <= 0) {
            return new PartialMeta(false, null, null);
        }
        if (totalCount != null && selectedCount >= totalCount) {
            return new PartialMeta(false, null, null);
        }
        return new PartialMeta(true, selectedCount, totalCount);
    }

    private static Integer parsePositiveInt(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            int parsed = Integer.parseInt(raw.trim());
            return parsed > 0 ? parsed : null;
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    private static boolean isAutoRetry(KestraExecutionSnapshot execution) {
        if (execution.attemptNumber() != null && execution.attemptNumber() > 1) {
            return true;
        }
        String originalId = execution.originalId();
        String id = execution.id();
        return originalId != null && !originalId.isBlank() && id != null && !originalId.equals(id);
    }

    private record PartialMeta(boolean partial, Integer selectedCount, Integer totalCount) {
    }

    record Classification(
            boolean rerun,
            String rerunType,
            Integer retryAttempt,
            boolean partialRerun,
            Integer rerunSelectedTaskCount,
            Integer rerunTotalTaskCount
    ) {
        Classification(boolean rerun, String rerunType, Integer retryAttempt) {
            this(rerun, rerunType, retryAttempt, false, null, null);
        }
    }
}
