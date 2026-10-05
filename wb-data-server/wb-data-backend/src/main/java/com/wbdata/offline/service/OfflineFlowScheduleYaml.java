package com.wbdata.offline.service;

import com.wbdata.offline.dto.OfflineFlowSchedule;
import com.wbdata.offline.enums.OfflineSchedulePeriod;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 调度 trigger 与周期 label 的读写。
 * 变更方法只负责把调度写进 YAML 并返回新 source；
 * 依赖闸门的统一重生成由入口 {@link OfflineFlowYamlSupport} 收尾，避免闸门逻辑散落多处。
 */
final class OfflineFlowScheduleYaml {

    static final String SCHEDULE_PERIOD_LABEL = "wbdataSchedulePeriod";
    private static final String RECOVER_MISSED_SCHEDULES_NONE = "NONE";

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
        return new OfflineFlowYamlSupport.ScheduleData(
                yaml.requiredString(trigger, "id"),
                cron,
                yaml.readOptionalString(trigger, "timezone"),
                !Boolean.TRUE.equals(trigger.get("disabled")),
                readPeriod(root, cron)
        );
    }

    String updateSchedule(String source, String cron, String timezone, OfflineSchedulePeriod period) {
        return applySchedule(source, new OfflineFlowSchedule(cron, timezone, true, period));
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

        Map<String, Object> labels = new LinkedHashMap<>();
        labels.putAll(yaml.asStringObjectMap(root.get("labels")));
        labels.put(SCHEDULE_PERIOD_LABEL, schedule.period().name());
        root.put("labels", labels);
        return yaml.dump(root);
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
        if (isFixedNumber(parts[0]) && "*".equals(parts[1]) && "*".equals(parts[2])
                && "*".equals(parts[3]) && "*".equals(parts[4])) {
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
