package io.wbdata.kestra.core;

import io.kestra.core.models.executions.Execution;
import io.kestra.core.models.executions.ExecutionTrigger;
import io.kestra.core.models.flows.State;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class WaitUpstreamStaticsTest {

    @Test
    void parsePlannedTime_acceptsZonedIsoWithRegion() {
        ZonedDateTime parsed = WaitUpstream.parsePlannedTime("2026-09-29T02:00:00+08:00[Asia/Shanghai]");
        assertThat(parsed.getZone()).isEqualTo(ZoneId.of("Asia/Shanghai"));
        assertThat(parsed.toLocalDate().toString()).isEqualTo("2026-09-29");
    }

    @Test
    void parsePlannedTime_acceptsOffsetAndInstantForms() {
        assertThat(WaitUpstream.parsePlannedTime("2026-09-29T02:00:00+08:00").toOffsetDateTime().getOffset())
                .hasToString("+08:00");
        assertThat(WaitUpstream.parsePlannedTime("2026-09-29T00:00:00Z").toInstant())
                .isEqualTo(Instant.parse("2026-09-29T00:00:00Z"));
        // 无偏移的本地时间按 UTC 兜底
        assertThat(WaitUpstream.parsePlannedTime("2026-09-29T02:00:00").getZone())
                .isEqualTo(ZoneId.of("UTC"));
    }

    @Test
    void parsePlannedTime_rejectsGarbage() {
        assertThatThrownBy(() -> WaitUpstream.parsePlannedTime("not-a-time"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> WaitUpstream.parsePlannedTime(null))
                .isInstanceOf(NullPointerException.class);
    }

    @Test
    void executionPlannedTime_prefersPlannedTimeInput() {
        Execution execution = execution(
                Map.of(WaitUpstream.PLANNED_TIME_INPUT, "2026-09-29T02:00:00+08:00[Asia/Shanghai]"),
                Map.of("date", "2026-09-01T02:00:00+08:00[Asia/Shanghai]"));
        // 手动重跑传的计划时间优先于 trigger.date
        assertThat(WaitUpstream.executionPlannedTime(execution).toLocalDate().toString())
                .isEqualTo("2026-09-29");
    }

    @Test
    void executionPlannedTime_fallsBackToTriggerDate() {
        Execution execution = execution(null, Map.of("date", "2026-09-01T02:00:00+08:00[Asia/Shanghai]"));
        assertThat(WaitUpstream.executionPlannedTime(execution).toLocalDate().toString())
                .isEqualTo("2026-09-01");
    }

    @Test
    void executionPlannedTime_nullWhenNeitherPresent() {
        assertThat(WaitUpstream.executionPlannedTime(execution(null, null))).isNull();
    }

    @Test
    void stateSets_matchSpec() {
        assertThat(WaitUpstream.SATISFIED_STATES).containsExactly(State.Type.SUCCESS);
        assertThat(WaitUpstream.TERMINAL_STATES).containsExactlyInAnyOrder(
                State.Type.SUCCESS, State.Type.WARNING, State.Type.FAILED, State.Type.KILLED, State.Type.CANCELLED);
    }

    private Execution execution(Map<String, Object> inputs, Map<String, Object> triggerVariables) {
        return Execution.builder()
                .id("test-execution")
                .namespace("wbtest")
                .flowId("test-flow")
                .state(new State(State.Type.RUNNING, List.of()))
                .inputs(inputs)
                .trigger(triggerVariables == null ? null : ExecutionTrigger.builder()
                        .id("schedule")
                        .type("io.kestra.plugin.core.trigger.Schedule")
                        .variables(triggerVariables)
                        .build())
                .build();
    }
}
