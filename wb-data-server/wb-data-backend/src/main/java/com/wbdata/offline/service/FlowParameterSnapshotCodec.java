package com.wbdata.offline.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wbdata.offline.dto.FlowParameterDefinitionSnapshot;
import com.wbdata.offline.dto.FlowParameterGroupBindingSnapshot;
import com.wbdata.offline.dto.FlowParameterSnapshot;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

final class FlowParameterSnapshotCodec {
    private FlowParameterSnapshotCodec() {
    }

    static FlowParameterSnapshot read(ObjectMapper objectMapper, String content) throws JsonProcessingException {
        JsonNode root = objectMapper.readTree(content);
        int schemaVersion = root.path("schemaVersion").asInt(0);
        if (schemaVersion == 2) {
            return objectMapper.treeToValue(root, FlowParameterSnapshot.class);
        }
        if (schemaVersion != 1) {
            throw new UnsupportedSchemaVersionException(schemaVersion);
        }

        List<FlowParameterDefinitionSnapshot> definitions = readLegacyDefinitions(root.path("definitions"));
        List<FlowParameterGroupBindingSnapshot> groups = readLegacyGroups(root.path("groups"));
        String runtimeTimezone = resolveLegacyRuntimeTimezone(root);
        return new FlowParameterSnapshot(
                1,
                runtimeTimezone,
                text(root, "groupCode"),
                root.path("groupVersion").asInt(0),
                definitions,
                groups.isEmpty() ? null : groups
        );
    }

    private static List<FlowParameterGroupBindingSnapshot> readLegacyGroups(JsonNode groupsNode) {
        if (!groupsNode.isArray()) {
            return List.of();
        }
        List<FlowParameterGroupBindingSnapshot> groups = new ArrayList<>();
        for (JsonNode groupNode : groupsNode) {
            groups.add(new FlowParameterGroupBindingSnapshot(
                    text(groupNode, "groupCode"),
                    groupNode.path("groupVersion").asInt(0),
                    readLegacyDefinitions(groupNode.path("definitions"))
            ));
        }
        return List.copyOf(groups);
    }

    private static List<FlowParameterDefinitionSnapshot> readLegacyDefinitions(JsonNode definitionsNode) {
        if (!definitionsNode.isArray()) {
            return List.of();
        }
        List<FlowParameterDefinitionSnapshot> definitions = new ArrayList<>();
        for (JsonNode definition : definitionsNode) {
            definitions.add(new FlowParameterDefinitionSnapshot(
                    text(definition, "key"),
                    text(definition, "valueSource"),
                    nullableText(definition, "constantValue"),
                    nullableText(definition, "format"),
                    definition.hasNonNull("offsetDays")
                            ? definition.path("offsetDays").asInt()
                            : definition.path("offsetAmount").asInt(0),
                    nullableText(definition, "description"),
                    definition.path("sortOrder").asInt(0),
                    nullableText(definition, "timeBasis")
            ));
        }
        return List.copyOf(definitions);
    }

    private static String resolveLegacyRuntimeTimezone(JsonNode root) {
        String explicit = nullableText(root, "runtimeTimezone");
        if (explicit != null && !explicit.isBlank()) {
            return explicit;
        }
        Set<String> timezones = new LinkedHashSet<>();
        collectLegacyTimezones(root.path("definitions"), timezones);
        if (root.path("groups").isArray()) {
            for (JsonNode group : root.path("groups")) {
                collectLegacyTimezones(group.path("definitions"), timezones);
            }
        }
        return timezones.size() == 1 ? timezones.iterator().next() : null;
    }

    private static void collectLegacyTimezones(JsonNode definitions, Set<String> timezones) {
        if (!definitions.isArray()) {
            return;
        }
        for (JsonNode definition : definitions) {
            String timezone = nullableText(definition, "timezone");
            if (timezone != null && !timezone.isBlank()) {
                timezones.add(timezone);
            }
        }
    }

    private static String text(JsonNode node, String field) {
        return node.path(field).asText(null);
    }

    private static String nullableText(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value == null || value.isNull() ? null : value.asText();
    }

    static final class UnsupportedSchemaVersionException extends RuntimeException {
        private final int schemaVersion;

        UnsupportedSchemaVersionException(int schemaVersion) {
            this.schemaVersion = schemaVersion;
        }

        int schemaVersion() {
            return schemaVersion;
        }
    }
}
