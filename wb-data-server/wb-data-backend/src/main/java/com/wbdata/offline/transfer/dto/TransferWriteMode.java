package com.wbdata.offline.transfer.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

import java.util.Arrays;

public enum TransferWriteMode {
    APPEND("append"),
    OVERWRITE_TABLE("overwrite_table"),
    OVERWRITE_PARTITION("overwrite_partition");

    private final String value;

    TransferWriteMode(String value) {
        this.value = value;
    }

    @JsonCreator
    public static TransferWriteMode fromValue(String value) {
        return Arrays.stream(values())
                .filter(mode -> mode.value.equals(value))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Unsupported transfer write mode: " + value));
    }

    @JsonValue
    public String value() {
        return value;
    }
}
