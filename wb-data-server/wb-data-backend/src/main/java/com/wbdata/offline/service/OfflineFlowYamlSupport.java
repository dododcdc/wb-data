package com.wbdata.offline.service;

import com.wbdata.offline.config.OfflineTransferProperties;
import com.wbdata.offline.dto.OfflineFlowDependencyRef;
import com.wbdata.offline.dto.OfflineFlowDependencySettings;
import com.wbdata.offline.dto.OfflineFlowSchedule;
import com.wbdata.offline.enums.OfflineCrossGroupDependency;
import com.wbdata.offline.enums.OfflineFailurePolicy;
import com.wbdata.offline.enums.OfflineSchedulePeriod;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Flow YAML 操作的统一入口：组合调度、依赖闸门、图编译三个协作类，
 * 并持有「调度/依赖/图变更 → 闸门统一重生成」的链式收尾不变量。
 * 各领域实现见 {@link OfflineFlowScheduleYaml} / {@link OfflineFlowDependencyYaml} / {@link OfflineFlowGraphYaml}，
 * 结构读写原语见 {@link FlowYamlCodec}。
 */
final class OfflineFlowYamlSupport {

    private final FlowYamlCodec yaml;
    private final OfflineFlowScheduleYaml scheduleYaml;
    private final OfflineFlowDependencyYaml dependencyYaml;
    private final OfflineFlowGraphYaml graphYaml;

    OfflineFlowYamlSupport() {
        this(new OfflineNodeTaskCompiler());
    }

    OfflineFlowYamlSupport(OfflineTransferProperties transferProperties) {
        this(new OfflineNodeTaskCompiler(transferProperties));
    }

    private OfflineFlowYamlSupport(OfflineNodeTaskCompiler nodeTaskCompiler) {
        this.yaml = new FlowYamlCodec();
        this.scheduleYaml = new OfflineFlowScheduleYaml(yaml);
        this.dependencyYaml = new OfflineFlowDependencyYaml(yaml, scheduleYaml);
        this.graphYaml = new OfflineFlowGraphYaml(yaml, dependencyYaml, nodeTaskCompiler);
    }

    String buildEmptyFlowYaml(String flowId, String namespace) {
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("id", flowId);
        root.put("namespace", namespace);
        root.put("tasks", List.of());
        return yaml.dump(root);
    }

    FlowIdentity parseIdentity(String source) {
        Map<String, Object> root = yaml.loadRoot(source);
        return new FlowIdentity(yaml.requiredString(root, "namespace"), yaml.requiredString(root, "id"));
    }

    String readLabel(String source, String key) {
        return yaml.readLabelValue(yaml.loadRoot(source), key);
    }

    String buildDebugFlow(String source,
                          String debugNamespace,
                          String flowPath,
                          Long groupId,
                          Long requestedBy,
                          String branch,
                          String sourceRevision,
                          String mode,
                          List<String> selectedTaskIds) {
        return buildDebugFlow(source, debugNamespace, flowPath, groupId, requestedBy, branch,
                sourceRevision, mode, selectedTaskIds, Set.of());
    }

    String buildDebugFlow(String source,
                          String debugNamespace,
                          String flowPath,
                          Long groupId,
                          Long requestedBy,
                          String branch,
                          String sourceRevision,
                          String mode,
                          List<String> selectedTaskIds,
                          Set<String> parameterOverrideKeys) {
        Map<String, Object> root = yaml.loadRoot(source);
        root.put("namespace", debugNamespace);
        root.remove("triggers");
        dependencyYaml.stripDependencyGate(root);

        Map<String, Object> labels = new LinkedHashMap<>();
        labels.putAll(yaml.asStringObjectMap(root.get("labels")));
        labels.put("wbdataMode", "DEBUG");
        labels.put("wbdataFlowPath", flowPath);
        labels.put("wbdataGroupId", String.valueOf(groupId));
        labels.put("wbdataRequestedBy", String.valueOf(requestedBy));
        labels.put("wbdataBranch", branch);
        labels.put("wbdataDebugNamespace", debugNamespace);
        labels.put("wbdataSourceRevision", sourceRevision);
        labels.put("wbdataSelectedTaskIds", String.join("---", new LinkedHashSet<>(selectedTaskIds)));
        if (parameterOverrideKeys == null || parameterOverrideKeys.isEmpty()) {
            labels.remove("wbdataParameterOverrideKeys");
        } else {
            labels.put("wbdataParameterOverrideKeys", String.join("---", parameterOverrideKeys));
        }
        root.put("labels", labels);

        if (!"ALL".equalsIgnoreCase(mode) && !"SELECTED".equalsIgnoreCase(mode)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "执行模式不合法");
        }
        if ("SELECTED".equalsIgnoreCase(mode)) {
            Set<String> selected = new LinkedHashSet<>(selectedTaskIds);
            if (selected.isEmpty()) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "请选择要执行的节点");
            }
            applySelection(yaml.requireTasks(root), selected);
        }

        return yaml.dump(root);
    }

    String applyParameterSnapshotId(String source, String snapshotId) {
        Map<String, Object> root = yaml.loadRoot(source);
        Map<String, Object> labels = new LinkedHashMap<>();
        labels.putAll(yaml.asStringObjectMap(root.get("labels")));
        if (snapshotId == null || snapshotId.isBlank()) {
            labels.remove(ExecutionParameterSnapshotRegistry.LABEL_KEY);
        } else {
            labels.put(ExecutionParameterSnapshotRegistry.LABEL_KEY, snapshotId);
        }
        if (labels.isEmpty()) {
            root.remove("labels");
        } else {
            root.put("labels", labels);
        }
        return yaml.dump(root);
    }

    String applyRuntimeTimezoneLabel(String source, String runtimeTimezone) {
        if (runtimeTimezone == null || runtimeTimezone.isBlank()) {
            return source;
        }
        Map<String, Object> root = yaml.loadRoot(source);
        Map<String, Object> labels = new LinkedHashMap<>();
        labels.putAll(yaml.asStringObjectMap(root.get("labels")));
        labels.put("wbdataRuntimeTimezone", runtimeTimezone.trim());
        root.put("labels", labels);
        return yaml.dump(root);
    }

    String sha256Hex(String content) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return java.util.HexFormat.of().formatHex(digest.digest(content.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("计算内容哈希失败", ex);
        }
    }

    ScheduleData readSchedule(String source) {
        return scheduleYaml.readSchedule(source);
    }

    String updateSchedule(String source, String cron, String timezone, OfflineSchedulePeriod period) {
        return applyDependencyGate(scheduleYaml.updateSchedule(source, cron, timezone, period));
    }

    String updateScheduleStatus(String source, boolean enabled) {
        return scheduleYaml.updateScheduleStatus(source, enabled);
    }

    /** 调度变更后闸门统一重生成，保持「调度 → 闸门」链式不变量。 */
    String applySchedule(String source, OfflineFlowSchedule schedule) {
        if (schedule == null) {
            return source;
        }
        return applyDependencyGate(scheduleYaml.applySchedule(source, schedule));
    }

    OfflineFlowDependencySettings readDependencyConfig(String source) {
        return dependencyYaml.readDependencyConfig(source);
    }

    List<OfflineFlowDependencyRef> readDependencies(String source) {
        return dependencyYaml.readDependencies(source);
    }

    OfflineFailurePolicy readFailurePolicy(String source) {
        return dependencyYaml.readFailurePolicy(source);
    }

    OfflineCrossGroupDependency readCrossGroupDependency(String source) {
        return dependencyYaml.readCrossGroupDependency(source);
    }

    String applyDependencyConfig(String source,
                                 List<OfflineFlowDependencyRef> dependencies,
                                 OfflineFailurePolicy failurePolicy,
                                 OfflineCrossGroupDependency crossGroupDependency) {
        return dependencyYaml.applyDependencyConfig(source, dependencies, failurePolicy, crossGroupDependency);
    }

    String applyDependencyGate(String source) {
        return dependencyYaml.applyDependencyGate(source);
    }

    List<String> collectNamespaceFiles(String source) {
        return graphYaml.collectNamespaceFiles(source);
    }

    FlowDocument parseDocument(String source) {
        return graphYaml.parseDocument(source);
    }

    FlowGraph parseGraph(String source) {
        return graphYaml.parseGraph(source);
    }

    String compileGraph(String existingSource,
                        List<OfflineFlowNode> nodes,
                        List<FlowEdge> edges,
                        java.util.Map<Long, com.wbdata.datasource.entity.DataSource> dataSourceMap) {
        return graphYaml.compileGraph(existingSource, nodes, edges, dataSourceMap);
    }

    String compileGraph(String existingSource,
                        List<OfflineFlowNode> nodes,
                        List<FlowEdge> edges,
                        java.util.Map<Long, com.wbdata.datasource.entity.DataSource> dataSourceMap,
                        FlowParameterCompiler.Compilation parameterCompilation) {
        return graphYaml.compileGraph(existingSource, nodes, edges, dataSourceMap, parameterCompilation);
    }

    private boolean applySelection(List<Map<String, Object>> tasks, Set<String> selectedTaskIds) {
        boolean subtreeSelected = false;
        for (Map<String, Object> task : tasks) {
            boolean selected = selectedTaskIds.contains(yaml.requiredString(task, "id"));
            boolean descendantSelected = false;
            Object childTasks = task.get("tasks");
            if (childTasks instanceof List<?> rawChildTasks && !rawChildTasks.isEmpty()) {
                if (yaml.isDagTask(task)) {
                    List<Map<String, Object>> dagChildren = yaml.castTaskList(rawChildTasks);
                    List<Map<String, Object>> unwrappedChildren = new ArrayList<>();
                    for (Map<String, Object> wrapper : dagChildren) {
                        Object innerTask = wrapper.get("task");
                        if (innerTask instanceof Map<?, ?> inner) {
                            unwrappedChildren.add((Map<String, Object>) inner);
                        }
                    }
                    descendantSelected = applySelection(unwrappedChildren, selectedTaskIds);
                    pruneDagDependencies(dagChildren);
                } else {
                    descendantSelected = applySelection(yaml.castTaskList(rawChildTasks), selectedTaskIds);
                }
            }

            boolean keepEnabled = selected || descendantSelected;
            // For Dag containers, we keep them enabled if any descendant is selected
            if (yaml.isDagTask(task)) {
                if (!descendantSelected) {
                    task.put("disabled", true);
                }
            } else if (!selected) {
                task.put("disabled", true);
            }
            subtreeSelected = subtreeSelected || keepEnabled;
        }
        return subtreeSelected;
    }

    @SuppressWarnings("unchecked")
    private void pruneDagDependencies(List<Map<String, Object>> dagTasks) {
        Set<String> enabledTaskIds = new LinkedHashSet<>();
        for (Map<String, Object> wrapper : dagTasks) {
            Object innerTask = wrapper.get("task");
            if (innerTask instanceof Map<?, ?> inner && !Boolean.TRUE.equals(inner.get("disabled"))) {
                enabledTaskIds.add(yaml.requiredString((Map<String, Object>) inner, "id"));
            }
        }

        for (Map<String, Object> wrapper : dagTasks) {
            Object dependsOn = wrapper.get("dependsOn");
            if (!(dependsOn instanceof List<?> dependencies)) {
                continue;
            }
            List<String> retained = dependencies.stream()
                    .filter(String.class::isInstance)
                    .map(String.class::cast)
                    .filter(enabledTaskIds::contains)
                    .toList();
            if (retained.isEmpty()) {
                wrapper.remove("dependsOn");
            } else {
                wrapper.put("dependsOn", retained);
            }
        }
    }

    record FlowIdentity(String namespace, String flowId) {
    }

    record FlowDocument(
            String flowId,
            String namespace,
            List<FlowStage> stages
    ) {
    }

    record FlowStage(
            String stageId,
            boolean parallel,
            List<OfflineFlowNode> nodes
    ) {
    }

    record FlowEdge(
            String source,
            String target
    ) {
    }

    record FlowGraph(
            String flowId,
            String namespace,
            List<OfflineFlowNode> nodes,
            List<FlowEdge> edges
    ) {
    }

    record ScheduleData(
            String triggerId,
            String cron,
            String timezone,
            boolean enabled,
            OfflineSchedulePeriod period
    ) {
    }

}
