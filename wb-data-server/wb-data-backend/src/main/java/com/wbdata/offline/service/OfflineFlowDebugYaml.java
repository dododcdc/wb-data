package com.wbdata.offline.service;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * debug 执行流编译：改写命名空间、写 debug labels、剥除依赖闸门与触发器（已拍板旁路），
 * SELECTED 模式下未选中的节点置 disabled 并裁剪指向它们的 dependsOn。
 */
final class OfflineFlowDebugYaml {

    private final FlowYamlCodec yaml;
    private final OfflineFlowDependencyYaml dependencyYaml;

    OfflineFlowDebugYaml(FlowYamlCodec yaml, OfflineFlowDependencyYaml dependencyYaml) {
        this.yaml = yaml;
        this.dependencyYaml = dependencyYaml;
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
}
