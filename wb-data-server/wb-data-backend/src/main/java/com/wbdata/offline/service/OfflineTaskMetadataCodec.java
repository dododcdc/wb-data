package com.wbdata.offline.service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

final class OfflineTaskMetadataCodec {
    private static final String PREFIX = "[wbdata-meta]";

    private OfflineTaskMetadataCodec() {
    }

    static ParsedTaskMetadata parse(String description) {
        if (description == null || description.isBlank()) {
            return ParsedTaskMetadata.empty();
        }

        String metadataLine = null;
        for (String line : description.split("\\R")) {
            if (line.startsWith(PREFIX)) {
                metadataLine = line;
            }
        }
        if (metadataLine == null) {
            return ParsedTaskMetadata.empty();
        }

        Long dataSourceId = null;
        String dataSourceType = null;
        String nodeKind = null;
        String transferConfigPath = null;
        String payload = metadataLine.substring(PREFIX.length()).trim();
        for (String entry : payload.split(";")) {
            String trimmed = entry.trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            int eqIndex = trimmed.indexOf('=');
            if (eqIndex <= 0 || eqIndex >= trimmed.length() - 1) {
                continue;
            }
            String key = trimmed.substring(0, eqIndex).trim();
            String value = trimmed.substring(eqIndex + 1).trim();
            if ("dataSourceId".equals(key)) {
                try {
                    dataSourceId = Long.parseLong(value);
                } catch (NumberFormatException ignored) {
                    // Ignore malformed historical metadata.
                }
            } else if ("dataSourceType".equals(key) && !value.isBlank()) {
                dataSourceType = value;
            } else if ("nodeKind".equals(key) && !value.isBlank()) {
                nodeKind = value;
            } else if ("transferConfigPath".equals(key) && !value.isBlank()) {
                transferConfigPath = value;
            }
        }
        return new ParsedTaskMetadata(dataSourceId, dataSourceType, nodeKind, transferConfigPath);
    }

    static String mergeDataSource(String existingDescription,
                                  Long dataSourceId,
                                  String dataSourceType,
                                  String nodeKind) {
        String cleaned = strip(existingDescription);
        StringBuilder metadata = new StringBuilder(PREFIX)
                .append(" dataSourceId=").append(dataSourceId)
                .append(";dataSourceType=").append(dataSourceType);
        if (nodeKind != null && !nodeKind.isBlank()) {
            metadata.append(";nodeKind=").append(nodeKind);
        }
        return appendMetadata(cleaned, metadata.toString());
    }

    static String mergeTransfer(String existingDescription, String transferConfigPath) {
        String cleaned = strip(existingDescription);
        String metadata = PREFIX + " nodeKind=TRANSFER;transferConfigPath=" + transferConfigPath;
        return appendMetadata(cleaned, metadata);
    }

    static void cleanup(Map<String, Object> task) {
        String cleaned = strip(readOptionalString(task, "description"));
        if (cleaned == null || cleaned.isBlank()) {
            task.remove("description");
        } else {
            task.put("description", cleaned);
        }
    }

    private static String appendMetadata(String cleanedDescription, String metadata) {
        if (cleanedDescription == null || cleanedDescription.isBlank()) {
            return metadata;
        }
        return cleanedDescription + "\n" + metadata;
    }

    private static String strip(String description) {
        if (description == null || description.isBlank()) {
            return description;
        }
        List<String> preservedLines = new ArrayList<>();
        for (String line : description.split("\\R")) {
            if (!line.startsWith(PREFIX)) {
                preservedLines.add(line);
            }
        }
        return String.join("\n", preservedLines).trim();
    }

    private static String readOptionalString(Map<String, Object> source, String key) {
        Object value = source.get(key);
        return value instanceof String text && !text.isBlank() ? text : null;
    }

    record ParsedTaskMetadata(
            Long dataSourceId,
            String dataSourceType,
            String nodeKind,
            String transferConfigPath
    ) {
        private static ParsedTaskMetadata empty() {
            return new ParsedTaskMetadata(null, null, null, null);
        }
    }
}
