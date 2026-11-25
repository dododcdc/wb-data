package com.wbdata.offline.service;

import com.wbdata.offline.schedule.dto.OfflineFlowSchedule;
import com.wbdata.offline.enums.OfflineSchedulePeriod;
import com.wbdata.schedule.HourlyCronHours;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 调度 trigger、失败重试配置与周期 label 的读写。
 * 变更方法只负责把调度写进 YAML 并返回新 source；
 * 依赖闸门的统一重生成由入口 {@link OfflineFlowYamlSupport} 收尾，避免闸门逻辑散落多处。
 */
final class OfflineFlowScheduleYaml {

    static final String SCHEDULE_PERIOD_LABEL = "wbdataSchedulePeriod";
    static final int MIN_RETRY_COUNT = 1;
    static final int MAX_RETRY_COUNT = 5;
    static final int MIN_RETRY_INTERVAL_MINUTES = 1;
    static final int MAX_RETRY_INTERVAL_MINUTES = 60;
    private static final String RECOVER_MISSED_SCHEDULES_NONE = "NONE";
    private static final String RETRY_TYPE_CONSTANT = "constant";
    private static final String RETRY_BEHAVIOR_CREATE_NEW_EXECUTION = "CREATE_NEW_EXECUTION";

    private final FlowYamlCodec yaml;

    OfflineFlowScheduleYaml(FlowYamlCodec yaml) {
        this.yaml = yaml;
    }

    OfflineFlowYamlSupport.ScheduleData readSchedule(String source) {
        Map<String, Object> root = yaml.loadRoot(source);
        Map<String, Object> trigger = findScheduleTrigger(root);
        if (trigger == null) {
            return null;
        }
        String cron = yaml.requiredString(trigger, "cron");
        RetryConfig retry = readRetry(root);
        return new OfflineFlowYamlSupport.ScheduleData(
                yaml.requiredString(trigger, "id"),
                cron,
                yaml.readOptionalString(trigger, "timezone"),
                !Boolean.TRUE.equals(trigger.get("disabled")),
                readPeriod(root, cron),
                retry.enabled(),
                retry.count(),
                retry.intervalMinutes()
        );
    }

    String updateSchedule(String source, String cron, String timezone, OfflineSchedulePeriod period) {
        return updateSchedule(source, cron, timezone, period, null, null, null);
    }

    String updateSchedule(String source,
                          String cron,
                          String timezone,
                          OfflineSchedulePeriod period,
                          Boolean retryEnabled,
                          Integer retryCount,
                          Integer retryIntervalMinutes) {
        boolean effectiveRetryEnabled;
        Integer effectiveRetryCount;
        Integer effectiveRetryIntervalMinutes;
        if (retryEnabled == null) {
            RetryConfig existingRetry = readRetry(yaml.loadRoot(source));
            effectiveRetryEnabled = existingRetry.enabled();
            effectiveRetryCount = existingRetry.count();
            effectiveRetryIntervalMinutes = existingRetry.intervalMinutes();
        } else if (Boolean.TRUE.equals(retryEnabled)) {
            effectiveRetryEnabled = true;
            effectiveRetryCount = retryCount;
            effectiveRetryIntervalMinutes = retryIntervalMinutes;
        } else {
            effectiveRetryEnabled = false;
            effectiveRetryCount = null;
            effectiveRetryIntervalMinutes = null;
        }
        return applySchedule(source, new OfflineFlowSchedule(
                cron,
                timezone,
                true,
                period,
                effectiveRetryEnabled,
                effectiveRetryCount,
                effectiveRetryIntervalMinutes
        ));
    }

    String updateScheduleStatus(String source, boolean enabled) {
        Map<String, Object> root = yaml.loadRoot(source);
        Map<String, Object> trigger = findScheduleTrigger(root);
        if (trigger == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "任务尚未配置调度");
        }
        if (enabled) {
            trigger.remove("disabled");
        } else {
            trigger.put("disabled", true);
        }
        return yaml.dump(root);
    }

    String applySchedule(String source, OfflineFlowSchedule schedule) {
        if (schedule.cron() == null || schedule.cron().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Cron 表达式不能为空");
        }
        if (schedule.period() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "调度频率不能为空");
        }
        if (schedule.period() == OfflineSchedulePeriod.HOURLY && !HourlyCronHours.isHourlyCron(schedule.cron())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "小时调度 Cron 不合法，需至少包含 2 个有效执行小时");
        }
        if (schedule.retryEnabled()) {
            Integer retryCount = schedule.retryCount();
            if (retryCount == null || retryCount < MIN_RETRY_COUNT || retryCount > MAX_RETRY_COUNT) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "失败重试次数需在 1 到 5 次之间");
            }
            Integer retryIntervalMinutes = schedule.retryIntervalMinutes();
            if (retryIntervalMinutes == null
                    || retryIntervalMinutes < MIN_RETRY_INTERVAL_MINUTES
                    || retryIntervalMinutes > MAX_RETRY_INTERVAL_MINUTES) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "失败重试间隔需在 1 到 60 分钟之间");
            }
        }

        Map<String, Object> root = yaml.loadRoot(source);
        Map<String, Object> trigger = findScheduleTrigger(root);
        if (trigger == null) {
            trigger = new LinkedHashMap<>();
            trigger.put("id", "schedule");
            trigger.put("type", "io.kestra.plugin.core.trigger.Schedule");
            yaml.ensureTriggers(root).add(trigger);
        }

        trigger.put("cron", schedule.cron());
        if (schedule.timezone() == null || schedule.timezone().isBlank()) {
            trigger.remove("timezone");
        } else {
            trigger.put("timezone", schedule.timezone());
        }
        trigger.put("recoverMissedSchedules", RECOVER_MISSED_SCHEDULES_NONE);
        if (schedule.enabled()) {
            trigger.remove("disabled");
        } else {
            trigger.put("disabled", true);
        }

        if (schedule.retryEnabled()) {
            Map<String, Object> retry = new LinkedHashMap<>();
            retry.put("type", RETRY_TYPE_CONSTANT);
            retry.put("interval", "PT" + schedule.retryIntervalMinutes() + "M");
            retry.put("maxAttempts", schedule.retryCount() + 1);
            retry.put("behavior", RETRY_BEHAVIOR_CREATE_NEW_EXECUTION);
            root.put("retry", retry);
        } else {
            root.remove("retry");
        }

        Map<String, Object> labels = new LinkedHashMap<>();
        labels.putAll(yaml.asStringObjectMap(root.get("labels")));
        labels.put(SCHEDULE_PERIOD_LABEL, schedule.period().name());
        root.put("labels", labels);
        return yaml.dump(root);
    }

    private RetryConfig readRetry(Map<String, Object> root) {
        if (!(root.get("retry") instanceof Map<?, ?> rawRetry)) {
            return RetryConfig.DISABLED;
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> retry = (Map<String, Object>) rawRetry;
        Integer maxAttempts = readPositiveInt(retry.get("maxAttempts"));
        if (maxAttempts == null) {
            maxAttempts = readPositiveInt(retry.get("maxAttempt"));
        }
        Integer intervalMinutes = readIntervalMinutes(yaml.readOptionalString(retry, "interval"));
        if (maxAttempts == null || maxAttempts <= 1 || intervalMinutes == null || intervalMinutes <= 0) {
            return RetryConfig.DISABLED;
        }
        return new RetryConfig(true, maxAttempts - 1, intervalMinutes);
    }

    private static Integer readPositiveInt(Object raw) {
        if (raw instanceof Number number) {
            int value = number.intValue();
            return value > 0 ? value : null;
        }
        if (raw instanceof String text && !text.isBlank()) {
            try {
                int value = Integer.parseInt(text.trim());
                return value > 0 ? value : null;
            } catch (NumberFormatException ignored) {
                return null;
            }
        }
        return null;
    }

    private static Integer readIntervalMinutes(String rawInterval) {
        if (rawInterval == null || rawInterval.isBlank()) {
            return null;
        }
        try {
            Duration duration = Duration.parse(rawInterval.trim());
            if (duration.isZero() || duration.isNegative()) {
                return null;
            }
            if (duration.getNano() != 0 || duration.toSeconds() % 60 != 0) {
                return null;
            }
            long minutes = duration.toMinutes();
            if (minutes < MIN_RETRY_INTERVAL_MINUTES || minutes > Integer.MAX_VALUE) {
                return null;
            }
            return (int) minutes;
        } catch (DateTimeParseException ignored) {
            return null;
        }
    }

    private record RetryConfig(boolean enabled, Integer count, Integer intervalMinutes) {
        private static final RetryConfig DISABLED = new RetryConfig(false, null, null);
    }

    private OfflineSchedulePeriod readPeriod(Map<String, Object> root, String cron) {
        String label = yaml.readLabelValue(root, SCHEDULE_PERIOD_LABEL);
        if (label != null) {
            try {
                return OfflineSchedulePeriod.valueOf(label.trim().toUpperCase());
            } catch (IllegalArgumentException ignored) {
                // 未知 label 值按未设置处理，回退到 cron 推断
            }
        }
        return inferPeriodFromCron(cron);
    }

    static OfflineSchedulePeriod inferPeriodFromCron(String cron) {
        if (cron == null) {
            return OfflineSchedulePeriod.CUSTOM;
        }
        String[] parts = cron.trim().split("\\s+");
        if (parts.length != 5) {
            return OfflineSchedulePeriod.CUSTOM;
        }
        if (HourlyCronHours.isHourlyCron(cron)) {
            return OfflineSchedulePeriod.HOURLY;
        }
        if (isFixedNumber(parts[0]) && isFixedNumber(parts[1]) && "*".equals(parts[2])
                && "*".equals(parts[3]) && "*".equals(parts[4])) {
            return OfflineSchedulePeriod.DAILY;
        }
        if (isFixedNumber(parts[0]) && isFixedNumber(parts[1]) && isFixedNumber(parts[2])
                && "*".equals(parts[3]) && "*".equals(parts[4])) {
            return OfflineSchedulePeriod.MONTHLY;
        }
        if (isFixedNumber(parts[0]) && isFixedNumber(parts[1]) && "*".equals(parts[2])
                && "*".equals(parts[3]) && isFixedNumber(parts[4])) {
            return OfflineSchedulePeriod.WEEKLY;
        }
        if (isFixedNumber(parts[0]) && isFixedNumber(parts[1]) && isFixedNumber(parts[2])
                && isFixedNumber(parts[3]) && "*".equals(parts[4])) {
            return OfflineSchedulePeriod.YEARLY;
        }
        return OfflineSchedulePeriod.CUSTOM;
    }

    private Map<String, Object> findScheduleTrigger(Map<String, Object> root) {
        for (Map<String, Object> trigger : yaml.ensureTriggers(root)) {
            if ("io.kestra.plugin.core.trigger.Schedule".equals(yaml.readOptionalString(trigger, "type"))) {
                return trigger;
            }
        }
        return null;
    }

    private static boolean isFixedNumber(String field) {
        return field.matches("\\d{1,2}");
    }
}
