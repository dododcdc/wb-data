package com.wbdata.query.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
import lombok.Getter;
import lombok.RequiredArgsConstructor;

@Getter
@RequiredArgsConstructor
public enum ExportFormat {
    CSV("csv", "text/csv"),
    XLSX("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

    @JsonValue
    private final String value;
    private final String mimeType;

    @JsonCreator
    public static ExportFormat fromValue(String value) {
        if (value == null) return CSV;
        for (ExportFormat format : values()) {
            if (format.value.equalsIgnoreCase(value)) {
                return format;
            }
        }
        throw new IllegalArgumentException("不支持的导出格式: " + value);
    }
}
