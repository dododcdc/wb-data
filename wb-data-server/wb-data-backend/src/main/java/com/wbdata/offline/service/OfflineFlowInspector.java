package com.wbdata.offline.service;

import com.wbdata.offline.schedule.dto.OfflineFlowDependencyRef;
import com.wbdata.offline.enums.OfflineFailurePolicy;
import com.wbdata.offline.enums.OfflineSchedulePeriod;

import java.util.List;

/**
 * 只读解析 flow YAML 的公开门面：供 offline 包外（如运维中心）读取调度与依赖配置，
 * 不承担任何写操作。调度/依赖的来源可以是 Kestra 里已同步的 flow source。
 */
public final class OfflineFlowInspector {

    public static final String RERUN_TASKS_INPUT = OfflineFlowGraphYaml.RERUN_TASKS_INPUT;

    private final OfflineFlowYamlSupport yamlSupport = new OfflineFlowYamlSupport();

    public InspectedFlow inspect(String source) {
        OfflineFlowYamlSupport.ScheduleData schedule = yamlSupport.readSchedule(source);
        return new InspectedFlow(
                yamlSupport.parseIdentity(source).flowId(),
                schedule == null ? null : new InspectedSchedule(
                        schedule.cron(),
                        schedule.timezone(),
                        schedule.enabled(),
                        schedule.period(),
                        schedule.retryEnabled(),
                        schedule.retryCount(),
                        schedule.retryIntervalMinutes()),
                yamlSupport.readDependencies(source),
                yamlSupport.readFailurePolicy(source)
        );
    }

    public InspectedGraph inspectGraph(String source) {
        return yamlSupport.inspectGraph(source);
    }

    public FlowIdentity parseIdentity(String source) {
        OfflineFlowYamlSupport.FlowIdentity identity = yamlSupport.parseIdentity(source);
        return new FlowIdentity(identity.namespace(), identity.flowId());
    }

    public record FlowIdentity(String namespace, String flowId) {
    }

    public record InspectedNode(String taskId, String kind, String dataSourceType) {
    }

    public record InspectedEdge(String source, String target) {
    }

    public record InspectedGraph(
            String flowId,
            String namespace,
            List<InspectedNode> nodes,
            List<InspectedEdge> edges,
            boolean partialRerunSupported
    ) {
    }

    public record InspectedSchedule(
            String cron,
            String timezone,
            boolean enabled,
            OfflineSchedulePeriod period,
            boolean retryEnabled,
            Integer retryCount,
            Integer retryIntervalMinutes
    ) {
        public InspectedSchedule(String cron, String timezone, boolean enabled, OfflineSchedulePeriod period) {
            this(cron, timezone, enabled, period, false, null, null);
        }
    }

    public record InspectedFlow(
            String flowId,
            InspectedSchedule schedule,
            List<OfflineFlowDependencyRef> dependencies,
            OfflineFailurePolicy failurePolicy
    ) {
    }
}
