package com.wbdata.offline.service;

import com.wbdata.offline.dto.OfflineFlowDependencyRef;
import com.wbdata.offline.enums.OfflineFailurePolicy;
import com.wbdata.offline.enums.OfflineSchedulePeriod;

import java.util.List;

/**
 * 只读解析 flow YAML 的公开门面：供 offline 包外（如运维中心）读取调度与依赖配置，
 * 不承担任何写操作。调度/依赖的来源可以是 Kestra 里已同步的 flow source。
 */
public final class OfflineFlowInspector {

    private final OfflineFlowYamlSupport yamlSupport = new OfflineFlowYamlSupport();

    public InspectedFlow inspect(String source) {
        OfflineFlowYamlSupport.ScheduleData schedule = yamlSupport.readSchedule(source);
        return new InspectedFlow(
                yamlSupport.parseIdentity(source).flowId(),
                schedule == null ? null : new InspectedSchedule(
                        schedule.cron(), schedule.timezone(), schedule.enabled(), schedule.period()),
                yamlSupport.readDependencies(source),
                yamlSupport.readFailurePolicy(source)
        );
    }

    public record InspectedSchedule(
            String cron,
            String timezone,
            boolean enabled,
            OfflineSchedulePeriod period
    ) {
    }

    public record InspectedFlow(
            String flowId,
            InspectedSchedule schedule,
            List<OfflineFlowDependencyRef> dependencies,
            OfflineFailurePolicy failurePolicy
    ) {
    }
}
