package com.wbdata.schedule;

import org.junit.jupiter.api.Test;

import java.time.ZoneId;
import java.time.ZonedDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SchedulePeriodKeysTest {

    @Test
    void key_matchesAllStandardPeriodsAndIsoWeekBoundaries() {
        ZonedDateTime planned = ZonedDateTime.parse("2026-01-01T11:11:11+08:00[Asia/Shanghai]");
        assertThat(SchedulePeriodKeys.key(StandardSchedulePeriod.DAILY, planned)).isEqualTo("2026-01-01");
        assertThat(SchedulePeriodKeys.key(StandardSchedulePeriod.HOURLY, planned)).isEqualTo("2026-01-01T11");
        assertThat(SchedulePeriodKeys.key(StandardSchedulePeriod.MONTHLY, planned)).isEqualTo("2026-01");
        assertThat(SchedulePeriodKeys.key(StandardSchedulePeriod.YEARLY, planned)).isEqualTo("2026");

        ZonedDateTime boundary1 = ZonedDateTime.parse("2025-12-31T02:00:00+08:00[Asia/Shanghai]");
        assertThat(SchedulePeriodKeys.key(StandardSchedulePeriod.WEEKLY, boundary1)).isEqualTo("2026-W01");

        ZonedDateTime boundary2 = ZonedDateTime.parse("2021-01-01T02:00:00+08:00[Asia/Shanghai]");
        assertThat(SchedulePeriodKeys.key(StandardSchedulePeriod.WEEKLY, boundary2)).isEqualTo("2020-W53");
    }

    @Test
    void previousPeriod_shiftsOnePeriodBack() {
        ZonedDateTime planned = ZonedDateTime.parse("2026-01-01T02:00:00+08:00[Asia/Shanghai]");
        assertThat(SchedulePeriodKeys.key(StandardSchedulePeriod.DAILY,
                SchedulePeriodKeys.previousPeriod(StandardSchedulePeriod.DAILY, planned))).isEqualTo("2025-12-31");
        assertThat(SchedulePeriodKeys.key(StandardSchedulePeriod.MONTHLY,
                SchedulePeriodKeys.previousPeriod(StandardSchedulePeriod.MONTHLY, planned))).isEqualTo("2025-12");
        assertThat(SchedulePeriodKeys.key(StandardSchedulePeriod.YEARLY,
                SchedulePeriodKeys.previousPeriod(StandardSchedulePeriod.YEARLY, planned))).isEqualTo("2025");
        assertThat(SchedulePeriodKeys.key(StandardSchedulePeriod.WEEKLY,
                SchedulePeriodKeys.previousPeriod(StandardSchedulePeriod.WEEKLY, planned))).isEqualTo("2025-W52");
        assertThat(SchedulePeriodKeys.key(StandardSchedulePeriod.HOURLY,
                SchedulePeriodKeys.previousPeriod(StandardSchedulePeriod.HOURLY, planned))).isEqualTo("2026-01-01T01");
    }

    @Test
    void periodStartAndEnd_roundTripsScheduleKey() {
        ZoneId zone = ZoneId.of("Asia/Shanghai");
        ZonedDateTime weekStart = SchedulePeriodKeys.periodStart(StandardSchedulePeriod.WEEKLY, "2026-W01", zone);
        assertThat(weekStart).isEqualTo(ZonedDateTime.parse("2025-12-29T00:00:00+08:00[Asia/Shanghai]"));
        assertThat(SchedulePeriodKeys.periodEnd(StandardSchedulePeriod.WEEKLY, weekStart))
                .isEqualTo(ZonedDateTime.parse("2026-01-05T00:00:00+08:00[Asia/Shanghai]"));

        assertThatThrownBy(() -> SchedulePeriodKeys.periodStart(StandardSchedulePeriod.WEEKLY, "2026-W99", zone))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void parse_validatesStandardPeriodNames() {
        assertThat(StandardSchedulePeriod.parse("daily")).isEqualTo(StandardSchedulePeriod.DAILY);
        assertThatThrownBy(() -> StandardSchedulePeriod.parse("CUSTOM"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> StandardSchedulePeriod.parse(" "))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
