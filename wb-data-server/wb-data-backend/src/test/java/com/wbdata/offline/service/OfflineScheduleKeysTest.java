package com.wbdata.offline.service;

import com.wbdata.offline.enums.OfflineSchedulePeriod;
import org.junit.jupiter.api.Test;

import java.time.ZonedDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class OfflineScheduleKeysTest {

    @Test
    void scheduleKey_dailyUsesCalendarDate() {
        ZonedDateTime planned = ZonedDateTime.parse("2026-01-01T11:11:11+08:00[Asia/Shanghai]");
        assertThat(OfflineScheduleKeys.scheduleKey(OfflineSchedulePeriod.DAILY, planned))
                .isEqualTo("2026-01-01");
    }

    @Test
    void scheduleKey_hourlyUsesDateAndHourSlot() {
        ZonedDateTime planned = ZonedDateTime.parse("2026-01-01T11:11:11+08:00[Asia/Shanghai]");
        assertThat(OfflineScheduleKeys.scheduleKey(OfflineSchedulePeriod.HOURLY, planned))
                .isEqualTo("2026-01-01T11");
    }

    @Test
    void scheduleKey_monthlyUsesYearMonth() {
        ZonedDateTime planned = ZonedDateTime.parse("2026-01-31T00:30:00+08:00[Asia/Shanghai]");
        assertThat(OfflineScheduleKeys.scheduleKey(OfflineSchedulePeriod.MONTHLY, planned))
                .isEqualTo("2026-01");
    }

    @Test
    void scheduleKey_weeklyUsesIsoWeek() {
        ZonedDateTime planned = ZonedDateTime.parse("2026-09-15T02:00:00+08:00[Asia/Shanghai]");
        assertThat(OfflineScheduleKeys.scheduleKey(OfflineSchedulePeriod.WEEKLY, planned))
                .isEqualTo("2026-W38");
    }

    @Test
    void scheduleKey_weeklyUsesWeekBasedYearOnBoundary() {
        // 2025-12-31 属于 ISO 2026 年第 1 周（周四 2026-01-01 落在该周），不能用日历年
        ZonedDateTime planned = ZonedDateTime.parse("2025-12-31T02:00:00+08:00[Asia/Shanghai]");
        assertThat(OfflineScheduleKeys.scheduleKey(OfflineSchedulePeriod.WEEKLY, planned))
                .isEqualTo("2026-W01");
    }

    @Test
    void scheduleKey_yearlyUsesCalendarYear() {
        ZonedDateTime planned = ZonedDateTime.parse("2026-01-01T02:00:00+08:00[Asia/Shanghai]");
        assertThat(OfflineScheduleKeys.scheduleKey(OfflineSchedulePeriod.YEARLY, planned))
                .isEqualTo("2026");
    }

    @Test
    void scheduleKey_rejectsCustomPeriod() {
        ZonedDateTime planned = ZonedDateTime.parse("2026-01-01T11:11:11+08:00[Asia/Shanghai]");
        assertThatThrownBy(() -> OfflineScheduleKeys.scheduleKey(OfflineSchedulePeriod.CUSTOM, planned))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void scheduleKey_rejectsNullArguments() {
        assertThatThrownBy(() -> OfflineScheduleKeys.scheduleKey(null, ZonedDateTime.now()))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> OfflineScheduleKeys.scheduleKey(OfflineSchedulePeriod.DAILY, null))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void inferPeriod_recognizesStandardShapes() {
        assertThat(OfflineFlowYamlSupport.inferPeriodFromCron("30 * * * *"))
                .isEqualTo(OfflineSchedulePeriod.HOURLY);
        assertThat(OfflineFlowYamlSupport.inferPeriodFromCron("0 2 * * *"))
                .isEqualTo(OfflineSchedulePeriod.DAILY);
        assertThat(OfflineFlowYamlSupport.inferPeriodFromCron("0 2 * * 1"))
                .isEqualTo(OfflineSchedulePeriod.WEEKLY);
        assertThat(OfflineFlowYamlSupport.inferPeriodFromCron("15 3 1 * *"))
                .isEqualTo(OfflineSchedulePeriod.MONTHLY);
        assertThat(OfflineFlowYamlSupport.inferPeriodFromCron("0 0 1 1 *"))
                .isEqualTo(OfflineSchedulePeriod.YEARLY);
    }

    @Test
    void inferPeriod_fallsBackToCustom() {
        assertThat(OfflineFlowYamlSupport.inferPeriodFromCron("* * * * *"))
                .isEqualTo(OfflineSchedulePeriod.CUSTOM);
        assertThat(OfflineFlowYamlSupport.inferPeriodFromCron("*/5 * * * *"))
                .isEqualTo(OfflineSchedulePeriod.CUSTOM);
        assertThat(OfflineFlowYamlSupport.inferPeriodFromCron("0 1,8,13 * * *"))
                .isEqualTo(OfflineSchedulePeriod.CUSTOM);
        assertThat(OfflineFlowYamlSupport.inferPeriodFromCron("0 2 * * 1,3,5"))
                .isEqualTo(OfflineSchedulePeriod.CUSTOM);
        assertThat(OfflineFlowYamlSupport.inferPeriodFromCron("not a cron"))
                .isEqualTo(OfflineSchedulePeriod.CUSTOM);
        assertThat(OfflineFlowYamlSupport.inferPeriodFromCron(null))
                .isEqualTo(OfflineSchedulePeriod.CUSTOM);
    }
}
