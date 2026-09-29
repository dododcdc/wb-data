package io.wbdata.kestra.core;

import org.junit.jupiter.api.Test;

import java.time.ZonedDateTime;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 与后端 OfflineScheduleKeysTest 共用测试向量，保证两侧 scheduleKey 语义一致。
 * 另覆盖 Pebble date 过滤器算错的 ISO 周跨年边界（见 docs/research/kestra-cross-flow-dependency-research.md）。
 */
class ScheduleKeysTest {

    @Test
    void key_dailyUsesCalendarDate() {
        ZonedDateTime planned = ZonedDateTime.parse("2026-01-01T11:11:11+08:00[Asia/Shanghai]");
        assertThat(ScheduleKeys.key(SchedulePeriod.DAILY, planned)).isEqualTo("2026-01-01");
    }

    @Test
    void key_hourlyUsesDateAndHourSlot() {
        ZonedDateTime planned = ZonedDateTime.parse("2026-01-01T11:11:11+08:00[Asia/Shanghai]");
        assertThat(ScheduleKeys.key(SchedulePeriod.HOURLY, planned)).isEqualTo("2026-01-01T11");
    }

    @Test
    void key_monthlyUsesYearMonth() {
        ZonedDateTime planned = ZonedDateTime.parse("2026-01-31T00:30:00+08:00[Asia/Shanghai]");
        assertThat(ScheduleKeys.key(SchedulePeriod.MONTHLY, planned)).isEqualTo("2026-01");
    }

    @Test
    void key_weeklyUsesIsoWeek() {
        ZonedDateTime planned = ZonedDateTime.parse("2026-09-15T02:00:00+08:00[Asia/Shanghai]");
        assertThat(ScheduleKeys.key(SchedulePeriod.WEEKLY, planned)).isEqualTo("2026-W38");
    }

    @Test
    void key_weeklyUsesWeekBasedYearOnBoundary() {
        // 2025-12-31 属于 ISO 2026 年第 1 周
        ZonedDateTime planned = ZonedDateTime.parse("2025-12-31T02:00:00+08:00[Asia/Shanghai]");
        assertThat(ScheduleKeys.key(SchedulePeriod.WEEKLY, planned)).isEqualTo("2026-W01");
    }

    @Test
    void key_weeklyUsesWeekBasedYearWhenPebbleFails() {
        // 2021-01-01 属于 ISO 2020 年第 53 周；Kestra Pebble date("YYYY-'W'ww") 会错算成 2021-W01
        ZonedDateTime planned = ZonedDateTime.parse("2021-01-01T02:00:00+08:00[Asia/Shanghai]");
        assertThat(ScheduleKeys.key(SchedulePeriod.WEEKLY, planned)).isEqualTo("2020-W53");
    }

    @Test
    void key_yearlyUsesCalendarYear() {
        ZonedDateTime planned = ZonedDateTime.parse("2026-01-01T02:00:00+08:00[Asia/Shanghai]");
        assertThat(ScheduleKeys.key(SchedulePeriod.YEARLY, planned)).isEqualTo("2026");
    }

    @Test
    void key_rejectsNullArguments() {
        assertThatThrownBy(() -> ScheduleKeys.key(null, ZonedDateTime.now()))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> ScheduleKeys.key(SchedulePeriod.DAILY, null))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void key_crossTimezoneSameLabelMatches() {
        // 中国 01-03 与柏林 01-03（绝对时刻差 7 小时）应是同一期
        ZonedDateTime shanghai = ZonedDateTime.parse("2026-01-03T02:00:00+08:00[Asia/Shanghai]");
        ZonedDateTime berlin = ZonedDateTime.parse("2026-01-03T02:00:00+01:00[Europe/Berlin]");
        assertThat(ScheduleKeys.key(SchedulePeriod.DAILY, shanghai))
                .isEqualTo(ScheduleKeys.key(SchedulePeriod.DAILY, berlin));
    }

    @Test
    void previousPeriod_shiftsOnePeriodBack() {
        ZonedDateTime planned = ZonedDateTime.parse("2026-01-01T02:00:00+08:00[Asia/Shanghai]");
        assertThat(ScheduleKeys.key(SchedulePeriod.DAILY,
                ScheduleKeys.previousPeriod(SchedulePeriod.DAILY, planned))).isEqualTo("2025-12-31");
        assertThat(ScheduleKeys.key(SchedulePeriod.MONTHLY,
                ScheduleKeys.previousPeriod(SchedulePeriod.MONTHLY, planned))).isEqualTo("2025-12");
        assertThat(ScheduleKeys.key(SchedulePeriod.YEARLY,
                ScheduleKeys.previousPeriod(SchedulePeriod.YEARLY, planned))).isEqualTo("2025");
        assertThat(ScheduleKeys.key(SchedulePeriod.WEEKLY,
                ScheduleKeys.previousPeriod(SchedulePeriod.WEEKLY, planned))).isEqualTo("2025-W52");
        assertThat(ScheduleKeys.key(SchedulePeriod.HOURLY,
                ScheduleKeys.previousPeriod(SchedulePeriod.HOURLY, planned))).isEqualTo("2026-01-01T01");
    }

    @Test
    void nextFire_dailyComputesNextPlannedInstant() {
        ZonedDateTime planned = ZonedDateTime.parse("2026-01-31T02:00:00+08:00[Asia/Shanghai]");
        Optional<ZonedDateTime> next = ScheduleKeys.nextFire("0 2 * * *", planned);
        assertThat(next).contains(ZonedDateTime.parse("2026-02-01T02:00:00+08:00[Asia/Shanghai]"));
    }

    @Test
    void nextFire_monthlyHandlesMonthLength() {
        ZonedDateTime planned = ZonedDateTime.parse("2026-01-01T02:00:00+08:00[Asia/Shanghai]");
        assertThat(ScheduleKeys.nextFire("0 2 1 * *", planned))
                .contains(ZonedDateTime.parse("2026-02-01T02:00:00+08:00[Asia/Shanghai]"));
        // 2 月无 31 日：3 月 31 日的下一期是 4 月 30 日
        ZonedDateTime march = ZonedDateTime.parse("2026-03-31T02:00:00+08:00[Asia/Shanghai]");
        assertThat(ScheduleKeys.nextFire("0 2 31 * *", march))
                .contains(ZonedDateTime.parse("2026-05-31T02:00:00+08:00[Asia/Shanghai]"));
    }

    @Test
    void nextFire_handlesDstGap() {
        // 柏林 2026-03-29 02:00 不存在（夏令时拨快）：cron 库跳过该无效点火点，
        // 与 Kestra Schedule 触发器（同一 cron 库）行为一致，闸门超时边界跟引擎走
        ZonedDateTime planned = ZonedDateTime.parse("2026-03-28T02:00:00+01:00[Europe/Berlin]");
        assertThat(ScheduleKeys.nextFire("0 2 * * *", planned))
                .contains(ZonedDateTime.parse("2026-03-30T02:00:00+02:00[Europe/Berlin]"));
    }

    @Test
    void nextFire_invalidCronFallsBackToEmpty() {
        ZonedDateTime planned = ZonedDateTime.parse("2026-01-01T02:00:00+08:00[Asia/Shanghai]");
        assertThat(ScheduleKeys.nextFire("not a cron", planned)).isEmpty();
        assertThat(ScheduleKeys.nextFire(null, planned)).isEmpty();
    }
}
