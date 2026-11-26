package com.wbdata.offline.kestra;

import java.util.List;

/**
 * Kestra 执行检索的单页结果，携带匹配的实体列表与服务端命中总数。
 */
public record KestraExecutionPage(
        List<KestraExecutionSnapshot> results,
        long total
) {

    public KestraExecutionPage {
        results = results == null ? List.of() : List.copyOf(results);
        total = Math.max(0L, total);
    }

    public static KestraExecutionPage empty() {
        return new KestraExecutionPage(List.of(), 0L);
    }
}
