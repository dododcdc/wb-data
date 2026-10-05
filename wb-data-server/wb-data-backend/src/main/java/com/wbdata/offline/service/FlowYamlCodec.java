package com.wbdata.offline.service;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import org.yaml.snakeyaml.DumperOptions;
import org.yaml.snakeyaml.Yaml;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Flow YAML 的 load/dump 与节点/触发器结构规整，供各 *Yaml 协作类共用。
 * 只做结构读写，不承载调度、依赖、图编译等领域语义。
 */
final class FlowYamlCodec {

    private final Yaml yaml;

    FlowYamlCodec() {
        DumperOptions options = new DumperOptions();
        options.setDefaultFlowStyle(DumperOptions.FlowStyle.BLOCK);
        options.setPrettyFlow(true);
        this.yaml = new Yaml(options);
    }

    String dump(Map<String, Object> root) {
        return yaml.dump(root);
    }

    @SuppressWarnings("unchecked")
    Map<String, Object> loadRoot(String source) {
        Object loaded = yaml.load(source);
        if (!(loaded instanceof Map<?, ?> rawRoot)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Flow YAML 格式不合法");
        }
        return (Map<String, Object>) rawRoot;
    }

    @SuppressWarnings("unchecked")
    List<Map<String, Object>> requireTasks(Map<String, Object> root) {
        Object tasks = root.get("tasks");
        if (!(tasks instanceof List<?> rawTasks)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Flow YAML tasks 定义不合法");
        }
        if (rawTasks.isEmpty()) {
            return List.of();
        }
        List<Map<String, Object>> normalized = new ArrayList<>();
        for (Object rawTask : rawTasks) {
            if (!(rawTask instanceof Map<?, ?> taskMap)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Flow YAML tasks 定义不合法");
            }
            normalized.add((Map<String, Object>) taskMap);
        }
        return normalized;
    }

    @SuppressWarnings("unchecked")
    List<Map<String, Object>> ensureTriggers(Map<String, Object> root) {
        Object triggers = root.get("triggers");
        if (triggers instanceof List<?> rawTriggers) {
            List<Map<String, Object>> normalized = new ArrayList<>();
            for (Object rawTrigger : rawTriggers) {
                if (!(rawTrigger instanceof Map<?, ?> triggerMap)) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Flow YAML triggers 定义不合法");
                }
                normalized.add((Map<String, Object>) triggerMap);
            }
            root.put("triggers", normalized);
            return normalized;
        }

        List<Map<String, Object>> created = new ArrayList<>();
        root.put("triggers", created);
        return created;
    }

    @SuppressWarnings("unchecked")
    Map<String, Object> asStringObjectMap(Object value) {
        if (value instanceof Map<?, ?> rawMap) {
            return (Map<String, Object>) rawMap;
        }
        return new LinkedHashMap<>();
    }

    @SuppressWarnings("unchecked")
    List<Map<String, Object>> castTaskList(List<?> rawChildTasks) {
        List<Map<String, Object>> childTasks = new ArrayList<>();
        for (Object rawTask : rawChildTasks) {
            if (!(rawTask instanceof Map<?, ?> taskMap)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Flow YAML tasks 定义不合法");
            }
            childTasks.add((Map<String, Object>) taskMap);
        }
        return childTasks;
    }

    boolean isDagTask(Map<String, Object> task) {
        return "io.kestra.plugin.core.flow.Dag".equals(readOptionalString(task, "type"));
    }

    String requiredString(Map<String, Object> root, String key) {
        Object value = root.get(key);
        if (value instanceof String text && !text.isBlank()) {
            return text;
        }
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Flow YAML 缺少字段: " + key);
    }

    String readOptionalString(Map<String, Object> root, String key) {
        Object value = root.get(key);
        return value instanceof String text && !text.isBlank() ? text : null;
    }
}
