package com.wbdata.offline.transfer.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

import java.util.Arrays;

public enum TransferMappingKind {
    SOURCE_FIELD("source_field"),
    STATIC_VALUE("static_value"),
    SOURCE_EXPRESSION("source_expression");

    private final String value;

    TransferMappingKind(String value) {
        this.value = value;
    }

    @JsonCreator
    public static TransferMappingKind fromValue(String value) {
        return Arrays.stream(values())
                .filter(kind -> kind.value.equals(value))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Unsupported transfer mapping kind: " + value));
    }

    @JsonValue
    public String value() {
        return value;
    }
}
