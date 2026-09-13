package com.wbdata.offline.service;

import com.wbdata.offline.dto.FlowParameterDefinitionSnapshot;
import com.wbdata.offline.dto.FlowParameterSnapshot;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ExecutionParameterResolverTest {

    private final ExecutionParameterResolver resolver = new ExecutionParameterResolver();

    @Test
    void keepsAllOverrideValuesAsOpaqueStrings() {
        Map<String, String> requested = new LinkedHashMap<>();
        requested.put("name", " 李雷 ");
        requested.put("count", " 002 ");
        requested.put("enabled", " TRUE ");
        requested.put("run_date", " 2026-08-15 ");
        requested.put("run_time", " 2026-08-15T09:30:00+08:00 ");

        assertThat(resolver.resolveOverrides(snapshot(), requested)).containsExactly(
                Map.entry("name", " 李雷 "),
                Map.entry("count", " 002 "),
                Map.entry("enabled", " TRUE "),
                Map.entry("run_date", " 2026-08-15 "),
                Map.entry("run_time", " 2026-08-15T09:30:00+08:00 ")
        );
    }

    @Test
    void rejectsUnknownAndNullOverridesBeforeCallingKestra() {
        assertThatThrownBy(() -> resolver.resolveOverrides(snapshot(), Map.of("missing", "1")))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("missing");

        Map<String, String> withNull = new LinkedHashMap<>();
        withNull.put("name", null);
        assertThatThrownBy(() -> resolver.resolveOverrides(snapshot(), withNull))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("不支持 null")
                .hasMessageContaining("name");
    }

    @Test
    void rejectsOverridesWhenFlowHasNoParameterSnapshot() {
        assertThatThrownBy(() -> resolver.resolveOverrides(null, Map.of("name", "李雷")))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("未绑定参数组");
        assertThat(resolver.resolveOverrides(null, Map.of())).isEmpty();
    }

    @Test
    void resolvesFinalValuesAndSourcesFromOriginalExecutionTime() {
        FlowParameterSnapshot snapshot = new FlowParameterSnapshot(2, "Asia/Shanghai", "daily", 3, List.of(
                new FlowParameterDefinitionSnapshot(
                        "name", "CONSTANT", "小明", null, 0, null, 0, null),
                new FlowParameterDefinitionSnapshot(
                        "v_day", "SYSTEM_TIME", null, "yyyyMMdd", -1, null, 1, "PLANNED_TIME")
        ));

        var resolution = resolver.resolveExecution(
                snapshot,
                Map.of("name", "李雷"),
                new ExecutionTimeContext(
                        Instant.parse("2026-08-15T01:00:00Z"),
                        Instant.parse("2026-08-20T01:00:00Z")
                ),
                Set.of("name")
        );

        assertThat(resolution.status()).isEqualTo("AVAILABLE");
        assertThat(resolution.parameters())
                .extracting(parameter -> parameter.key() + "=" + parameter.value() + ":" + parameter.source())
                .containsExactly(
                        "name=李雷:MANUAL_OVERRIDE",
                        "v_day=20260814:SYSTEM_TIME"
                );
    }

    @Test
    void resolvesEachSystemTimeFromItsOwnExplicitClock() {
        FlowParameterSnapshot snapshot = new FlowParameterSnapshot(2, "UTC", "daily", 3, List.of(
                new FlowParameterDefinitionSnapshot(
                        "v_plan_day", "SYSTEM_TIME", null, "yyyyMMdd", 0, null, 0, "PLANNED_TIME"),
                new FlowParameterDefinitionSnapshot(
                        "v_start_day", "SYSTEM_TIME", null, "yyyyMMdd", 0, null, 1, "EXECUTION_START_TIME")
        ));

        var resolution = resolver.resolveExecution(
                snapshot,
                Map.of(),
                new ExecutionTimeContext(
                        Instant.parse("2026-01-01T02:00:00Z"),
                        Instant.parse("2026-08-01T10:00:00Z")
                ),
                Set.of()
        );

        assertThat(resolution.status()).isEqualTo("AVAILABLE");
        assertThat(resolution.parameters())
                .extracting(parameter -> parameter.key() + "=" + parameter.value())
                .containsExactly("v_plan_day=20260101", "v_start_day=20260801");
    }

    @Test
    void resolvesDayOffsetsAsCalendarDaysAcrossDstBoundaries() {
        FlowParameterSnapshot snapshot = new FlowParameterSnapshot(2, "America/New_York", "daily", 3, List.of(
                new FlowParameterDefinitionSnapshot(
                        "spring_forward", "SYSTEM_TIME", null, "yyyy-MM-dd HH:mm XXX",
                        1, null, 0, "PLANNED_TIME"),
                new FlowParameterDefinitionSnapshot(
                        "fall_back", "SYSTEM_TIME", null, "yyyy-MM-dd HH:mm XXX",
                        1, null, 1, "EXECUTION_START_TIME")
        ));

        var resolution = resolver.resolveExecution(
                snapshot,
                Map.of(),
                new ExecutionTimeContext(
                        Instant.parse("2026-03-08T06:30:00Z"),
                        Instant.parse("2026-11-01T04:30:00Z")
                ),
                Set.of()
        );

        assertThat(resolution.parameters())
                .extracting(parameter -> parameter.key() + "=" + parameter.value())
                .containsExactly(
                        "spring_forward=2026-03-09 01:30 -04:00",
                        "fall_back=2026-11-02 00:30 -05:00"
                );
    }

    @Test
    void rejectsSystemTimeWhenFlowTimezoneIsMissing() {
        FlowParameterSnapshot snapshot = new FlowParameterSnapshot(2, null, "daily", 3, List.of(
                new FlowParameterDefinitionSnapshot(
                        "v_day", "SYSTEM_TIME", null, "yyyyMMdd", 0, null, 0, "PLANNED_TIME")
        ));

        assertThatThrownBy(() -> resolver.resolveExecution(
                snapshot,
                Map.of(),
                new ExecutionTimeContext(
                        Instant.parse("2026-08-15T00:00:00Z"),
                        Instant.parse("2026-08-15T00:00:00Z")
                ),
                Set.of()
        ))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("任务运行时区不能为空");
    }

    @Test
    void reportsPendingForOnlyTheMissingClockWithoutImplicitFallback() {
        FlowParameterSnapshot snapshot = new FlowParameterSnapshot(2, "UTC", "daily", 3, List.of(
                new FlowParameterDefinitionSnapshot(
                        "v_day", "SYSTEM_TIME", null, "yyyyMMdd", 0, null, 0, "PLANNED_TIME")
        ));

        var resolution = resolver.resolveExecution(
                snapshot,
                Map.of(),
                new ExecutionTimeContext(null, Instant.parse("2026-08-01T10:00:00Z")),
                Set.of()
        );

        assertThat(resolution.status()).isEqualTo("PENDING");
        assertThat(resolution.parameters().getFirst().value()).isNull();
    }

    private FlowParameterSnapshot snapshot() {
        return new FlowParameterSnapshot(2, "Asia/Shanghai", "daily", 3, List.of(
                definition("name", "STRING"),
                definition("count", "INTEGER"),
                definition("enabled", "BOOLEAN"),
                definition("run_date", "DATE"),
                definition("run_time", "DATETIME")
        ));
    }

    private FlowParameterDefinitionSnapshot definition(String key, String dataType) {
        return new FlowParameterDefinitionSnapshot(
                key, "CONSTANT", "unused", null, 0, null, 0, null);
    }
}
