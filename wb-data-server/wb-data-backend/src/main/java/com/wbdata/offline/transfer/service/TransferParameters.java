package com.wbdata.offline.transfer.service;

import com.wbdata.offline.transfer.dto.TransferConfig;
import com.wbdata.offline.transfer.dto.TransferEndpointConfig;
import com.wbdata.offline.transfer.dto.TransferMappingKind;
import com.wbdata.sql.SqlParameterTemplate;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

public final class TransferParameters {
    private TransferParameters() {
    }

    public static Set<String> references(TransferConfig config) {
        Set<String> names = new LinkedHashSet<>();
        rejectEndpointIdentifiers(config.source());
        rejectEndpointIdentifiers(config.target());
        collectSql(config.source().where(), names);
        if (config.fieldMappings() != null) {
            config.fieldMappings().forEach(mapping -> collectMapping(mapping.kind(), mapping.target(),
                    mapping.source(), mapping.expression(), mapping.value(), names));
        }
        if (config.partitions() != null) {
            config.partitions().forEach(mapping -> collectMapping(mapping.kind(), mapping.target(),
                    mapping.source(), mapping.expression(), mapping.value(), names));
        }
        collectStatements(config.target().preSql(), names);
        collectStatements(config.target().postSql(), names);
        return names;
    }

    public static void requireValues(TransferConfig config, Map<String, String> parameters) {
        List<String> missing = references(config).stream().filter(name -> parameters.get(name) == null).toList();
        if (!missing.isEmpty()) {
            throw new IllegalArgumentException("传输引用了未提供的参数: " + String.join(", ", missing));
        }
    }

    public static String renderText(String text, Map<String, String> parameters) {
        return interpolate(text, name -> {
            String value = parameters.get(name);
            if (value == null) {
                throw new IllegalArgumentException("传输引用了未提供的参数: " + name);
            }
            return value;
        });
    }

    private static void collectMapping(TransferMappingKind kind, String target, String source,
                                       String expression, String value, Set<String> names) {
        rejectIdentifier(target);
        if (kind == TransferMappingKind.SOURCE_FIELD) {
            rejectIdentifier(source);
        } else if (kind == TransferMappingKind.SOURCE_EXPRESSION) {
            collectSql(expression, names);
        } else if (kind == TransferMappingKind.STATIC_VALUE) {
            interpolate(value, name -> {
                names.add(name);
                return "";
            });
        }
    }

    private static String interpolate(String text, Function<String, String> value) {
        if (text == null) {
            return null;
        }
        StringBuilder result = new StringBuilder();
        int start = 0;
        int opening;
        while ((opening = text.indexOf("^[", start)) >= 0) {
            result.append(text, start, opening);
            int closing = text.indexOf(']', opening + 2);
            if (closing < 0) {
                throw new IllegalArgumentException("参数引用必须使用 ^[name] 格式");
            }
            String name = SqlParameterTemplate.compile(text.substring(opening, closing + 1)).parameterNames().getFirst();
            result.append(value.apply(name));
            start = closing + 1;
        }
        return result.append(text, start, text.length()).toString();
    }

    private static void collectSql(String sql, Set<String> names) {
        names.addAll(SqlParameterTemplate.compile(sql).parameterNames());
    }

    private static void collectStatements(List<String> statements, Set<String> names) {
        if (statements != null) {
            statements.forEach(sql -> collectSql(sql, names));
        }
    }

    private static void rejectEndpointIdentifiers(TransferEndpointConfig endpoint) {
        rejectIdentifier(endpoint.database());
        rejectIdentifier(endpoint.table());
    }

    private static void rejectIdentifier(String value) {
        if (value != null && value.contains("^[")) {
            throw new IllegalArgumentException("数据库名、表名和字段名不支持参数占位符");
        }
    }
}
