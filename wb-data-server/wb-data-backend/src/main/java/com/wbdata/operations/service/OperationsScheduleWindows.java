package com.wbdata.operations.service;

import com.cronutils.model.CronType;
import com.cronutils.model.definition.CronDefinitionBuilder;
import com.cronutils.model.time.ExecutionTime;
import com.cronutils.parser.CronParser;
import com.wbdata.offline.enums.OfflineSchedulePeriod;
import com.wbdata.offline.service.OfflineScheduleKeys;
import com.wbdata.schedule.SchedulePeriodKeys;

import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.Optional;

/**
 * 调度业务期与 Cron 点火时间的换算：底层周期键与起止时间窗由 wb-data-common-core 统一提供。
 * 只处理标准周期；CUSTOM 由调用方先行拒绝。
 */
final class OperationsScheduleWindows {

    private static final CronParser UNIX_CRON_PARSER =
            new CronParser(CronDefinitionBuilder.instanceDefinitionFor(CronType.UNIX));

    private OperationsScheduleWindows() {
    }

    static Optional<ExecutionTime> cronTime(String cron) {
        if (cron == null || cron.isBlank()) {
            return Optional.empty();
        }
        try {
            return Optional.of(ExecutionTime.forCron(UNIX_CRON_PARSER.parse(cron.trim())));
        } catch (IllegalArgumentException ex) {
            return Optional.empty();
        }
    }

    /** 业务期键 → 该期起点（任务时区）。 */
    static ZonedDateTime periodStart(OfflineSchedulePeriod period, String scheduleKey, ZoneId zone) {
        if (period == null) {
            throw new IllegalArgumentException("周期不能为空");
        }
        return SchedulePeriodKeys.periodStart(period.toStandardPeriod(), scheduleKey, zone);
    }

    static ZonedDateTime periodEnd(OfflineSchedulePeriod period, ZonedDateTime periodStart) {
        if (period == null) {
            throw new IllegalArgumentException("周期不能为空");
        }
        return SchedulePeriodKeys.periodEnd(period.toStandardPeriod(), periodStart);
    }

    static ZonedDateTime shiftPeriod(OfflineSchedulePeriod period, ZonedDateTime time, int amount) {
        if (period == null) {
            throw new IllegalArgumentException("周期不能为空");
        }
        return SchedulePeriodKeys.shiftPeriod(period.toStandardPeriod(), time, amount);
    }

    /** 本期计划点火时间：[periodStart, periodEnd) 内的第一次 Cron 点火。 */
    static Optional<ZonedDateTime> plannedFire(ExecutionTime cronTime, ZonedDateTime periodStart, ZonedDateTime periodEnd) {
        return cronTime.nextExecution(periodStart.minusSeconds(1))
                .filter(fire -> fire.isBefore(periodEnd));
    }

    /** 给定时刻所属业务期的计划点火时间（最近一次已过的点火）。 */
    static Optional<ZonedDateTime> lastFire(ExecutionTime cronTime, ZonedDateTime time) {
        return cronTime.lastExecution(time);
    }

    static String key(OfflineSchedulePeriod period, ZonedDateTime plannedTime) {
        return OfflineScheduleKeys.scheduleKey(period, plannedTime);
    }
}
